import { fetchLibraryBlueprints, validateBlueprint, type Blueprint } from '@studio/blueprints';
import { generateBackupFilename } from '@studio/common/lib/generate-backup-filename';
import { numberedSiteName, pickSiteName } from '@studio/common/lib/site-names';
import {
	DEFAULT_COLOR_SCHEME,
	DEFAULT_HIDE_FRONTEND_ADMIN_BAR,
} from '@studio/common/lib/user-settings/preferences';
import { fetchWordPressVersions } from '@studio/common/lib/wordpress-versions';
import { fixSiteDesign, readSiteDesign } from '@studio/common/sites/site-design';
import {
	AGENT_INSTRUCTIONS_ENABLED_KEY,
	AGENT_INSTRUCTIONS_KEY,
	capturePreviewRegion,
	connectPreviewFrame,
	createStaticBackend,
	exportDatabaseSql,
	exportSiteZip,
	getPathSize,
	getSiteOrigin,
	kvGet,
	kvSet,
	kvUpdate,
	listFileTree,
	loadBlueprintBundle,
	loadPlaygroundClient,
	loadSiteOrigin,
	playgroundSiteFiles,
	readActiveThemeSlug,
	readGlobalStyles,
	readWordPressVersion,
	withSitePage,
	type BlueprintBundle,
} from '@studio/static';
import { __ } from '@wordpress/i18n';
import { download, menuShortcuts } from '../browser-tab';
import { buildPublishCheckoutUrl } from '../publish-checkout-url';
import { UnsupportedError } from '../unsupported-error';
import { readWapuuScore, writeWapuuScore } from '../wapuu-score-storage';
import type {
	AppGlobals,
	BlueprintSource,
	Connector,
	InstalledApps,
	OnboardingHintsState,
	SelectedSiteFolder,
	UserPreferences,
} from '../../types';

export { completeRedirectSignIn } from '@studio/static';

const WAPUU_SCORE_STORAGE_KEY = 'studio-wapuu-score';
const PREFERENCES_KEY = 'preferences';
const ONBOARDING_HINTS_KEY = 'onboarding-hints';
const DEBUG_LOG_PATH = '/wordpress/wp-content/debug.log';

const DEFAULT_PREFERENCES: UserPreferences = {
	editor: null,
	browser: null,
	terminal: null,
	colorScheme: DEFAULT_COLOR_SCHEME,
	locale: undefined,
	analyticsEnabled: false,
	defaultSiteDirectory: '/sites',
	studioCliInstalled: false,
	studioCliExternallyManaged: false,
};

const noSubscription = () => () => {};

/**
 * Studio on the web: the data source for a static deployment with no Studio
 * server. Sites run in WordPress Playground and persist in the browser's
 * private storage, WordPress.com is reached directly with the user's token, and
 * Studio Code runs in the page.
 */
export function createStaticConnector(): Connector {
	// Files the user picked, by the pseudo path `getFilePath` hands back.
	const pickedFiles = new Map< string, File >();
	const { sites, auth, wpcom, agent } = createStaticBackend( {
		readAttachment: ( filePath ) => pickedFiles.get( filePath ),
		download,
		hidesAdminBarByDefault: async () =>
			( await readPreferences() ).hideFrontendAdminBar ?? DEFAULT_HIDE_FRONTEND_ADMIN_BAR,
	} );

	async function pathSize( siteId: string, path: string[] ) {
		return getPathSize( await sites.client( siteId ), path.join( '/' ) );
	}

	async function readPreferences(): Promise< UserPreferences > {
		return {
			...DEFAULT_PREFERENCES,
			...( await kvGet< Partial< UserPreferences > >( PREFERENCES_KEY ) ),
		};
	}

	// Playground opens zip bundles and URLs itself; a Library slug resolves to its bundle.
	async function openBlueprint(
		source: BlueprintSource
	): Promise< { blueprint: Blueprint; bundle?: BlueprintBundle } > {
		if ( typeof source === 'object' && ! ( source instanceof File ) ) {
			return { blueprint: source };
		}
		if ( typeof source === 'string' && /^[\w-]+$/.test( source ) ) {
			const { locale } = await readPreferences();
			const entry = ( await fetchLibraryBlueprints( { locale } ) ).find(
				( item ) => item.slug === source
			);
			if ( ! entry ) {
				throw new Error( `Unknown Blueprint: ${ source }` );
			}
			return {
				blueprint: entry.blueprint,
				bundle: entry.bundleUrl ? await loadBlueprintBundle( entry.bundleUrl ) : undefined,
			};
		}
		const bundle = await loadBlueprintBundle( source );
		const declaration = await ( await loadPlaygroundClient() ).getBlueprintDeclaration( bundle );
		return { blueprint: validateBlueprint( declaration ), bundle };
	}

	return {
		async init() {
			// Ask the browser not to evict sites under storage pressure.
			await navigator.storage?.persist?.().catch( () => false );
			await loadSiteOrigin();
		},

		capabilities: {
			nativeFolderPicker: false,
			annotatePreview: true,
			studioLogs: false,
			nativeSites: false,
		},

		agenticRequiresAuth: false,
		getAuthUser: () => auth.user(),
		authenticate: async ( signup = false ) =>
			auth.authenticate( signup, ( await readPreferences() ).locale ),
		logout: () => auth.signOut(),
		onAuthStateChanged: ( listener ) => auth.onChange( listener ),
		async getOnboardingCompleted() {
			return true;
		},
		async setOnboardingCompleted() {},

		getSites: () => sites.getDetails(),
		async createSite( params ) {
			const { blueprint, bundle } = params.blueprint ? await openBlueprint( params.blueprint ) : {};
			return sites.create( { ...params, blueprint: blueprint && { blueprint } }, bundle );
		},
		deleteSite: ( id ) => sites.delete( id ),
		async copySite( sourceSiteId ) {
			const source = await sites.get( sourceSiteId );
			const names = new Set( ( await sites.list() ).map( ( site ) => site.name ) );
			const name = await numberedSiteName( `${ source.name } Copy`, ( n ) => ! names.has( n ) );
			return sites.copy( sourceSiteId, name );
		},
		startSite: ( id ) => sites.start( id ),
		stopSite: ( id ) => sites.stop( id ),
		updateSite: ( site ) => sites.update( site ),
		updateSitesSortOrder: ( updates ) => sites.updateSortOrder( updates ),
		getSiteThumbnail: ( siteId ) => sites.getThumbnail( siteId ),
		async captureAnnotationRegion( request ) {
			if ( ! ( 'frame' in request ) ) {
				throw new UnsupportedError( 'captureAnnotationRegion' );
			}
			return capturePreviewRegion( request.frame, request.selection );
		},
		async captureSitePreview( siteId, { path } ) {
			if ( /^\/?wp-(admin|login)/.test( path ) ) {
				return null;
			}
			const record = await sites.get( siteId );
			if ( ! sites.runtimes.isRunning( siteId ) ) {
				return null;
			}
			const thumbnail = await withSitePage( record.scope, path, ( page ) => page.capture() ).catch(
				() => null
			);
			if ( thumbnail ) {
				await sites.setThumbnail( siteId, thumbnail );
			}
			return thumbnail;
		},
		async getSiteDesign( siteId ) {
			const client = await sites.client( siteId );
			return readSiteDesign(
				playgroundSiteFiles( client ),
				() => readActiveThemeSlug( client ),
				() => readGlobalStyles( client )
			);
		},
		async fixSiteDesignDrift( siteId, fixes ) {
			const client = await sites.client( siteId );
			return fixSiteDesign(
				playgroundSiteFiles( client ),
				() => readActiveThemeSlug( client ),
				fixes
			);
		},
		// Playground sites send no email Studio can save.
		async getSiteEmails() {
			return [];
		},
		async getSiteEmail() {
			return null;
		},
		setSiteFrontendAdminBar: ( siteId, hidden ) => sites.setFrontendAdminBar( siteId, hidden ),
		// Agent apps run Studio's CLI, which a page doesn't have.
		async getAgentApps() {
			return [];
		},
		async connectAgentApp() {
			throw new UnsupportedError( 'connectAgentApp' );
		},

		async exportFullSite( siteId, options ) {
			const record = await sites.get( siteId );
			options?.onStarted?.();
			const zip = await exportSiteZip( await sites.client( siteId ) );
			const filename = `${ generateBackupFilename( record.name ) }.zip`;
			return download( zip as BlobPart, filename, 'application/zip' );
		},
		async exportDatabase( siteId, options ) {
			const record = await sites.get( siteId );
			options?.onStarted?.();
			const sql = await exportDatabaseSql( await sites.client( siteId ) );
			return download( sql, `${ generateBackupFilename( record.name ) }.sql`, 'application/sql' );
		},

		async generateProposedSitePath( siteName ) {
			return { path: await sites.uniquePath( siteName ), isEmpty: true, isWordPress: false };
		},
		async generateProposedSiteName( usedSites ) {
			return pickSiteName( ( name ) => ! usedSites.some( ( site ) => site.name === name ) );
		},
		async generateNumberedSiteName( baseName, usedSites ) {
			return numberedSiteName(
				baseName,
				( name ) => ! usedSites.some( ( site ) => site.name === name )
			);
		},
		// Sites have no folder to choose: the create form hides the path field.
		async selectSiteFolder(): Promise< SelectedSiteFolder | null > {
			return null;
		},
		async comparePaths( path1, path2 ) {
			return path1.replace( /\/+$/, '' ) === path2.replace( /\/+$/, '' );
		},

		getWordPressVersions: fetchWordPressVersions,
		async getWpVersion( siteId ) {
			if ( ! sites.runtimes.isRunning( siteId ) ) {
				const record = await sites.get( siteId );
				return record.wpVersion === 'latest' ? '-' : record.wpVersion;
			}
			return readWordPressVersion( await sites.client( siteId ) );
		},

		// A browser File has no path, so hand back a pseudo path that the
		// path-based operations (import, attachments) resolve to the File.
		async getFilePath( file ) {
			const path = `/picked/${ crypto.randomUUID() }/${ file.name }`;
			pickedFiles.set( path, file );
			return path;
		},
		async readLocalMediaFile( path ) {
			const file = pickedFiles.get( path );
			if ( ! file ) {
				throw new Error( `No file at ${ path }` );
			}
			return { name: file.name, mimeType: file.type, data: await file.arrayBuffer() };
		},
		async readBlueprint( source ) {
			return ( await openBlueprint( source ) ).blueprint;
		},
		async importSiteFromBackup( siteId, backupPath ) {
			const file = pickedFiles.get( backupPath );
			if ( ! file ) {
				throw new Error( `No file at ${ backupPath }` );
			}
			wpcom.emitSyncActivity( siteId, {
				kind: 'pending',
				direction: 'import',
				message: __( 'Importing backup…' ),
			} );
			try {
				await sites.import( siteId, file );
				wpcom.emitSyncActivity( siteId, { kind: 'success', direction: 'import' } );
			} catch ( error ) {
				wpcom.emitSyncActivity( siteId, {
					kind: 'error',
					direction: 'import',
					message: error instanceof Error ? error.message : String( error ),
				} );
				throw error;
			} finally {
				pickedFiles.delete( backupPath );
			}
		},

		getSnapshots: () => wpcom.getSnapshots(),
		getSnapshotUsage: () => wpcom.getSnapshotUsage(),
		getStudioAssistantQuota: () => wpcom.getQuota(),
		getStudioAssistantTopUpPricing: ( locale ) => wpcom.getTopUpPricing( locale ),
		deleteAllSnapshots: () => wpcom.deleteAllSnapshots(),
		async confirmDeleteAllPreviewSites() {
			return window.confirm(
				__(
					'All preview sites that exist for your WordPress.com account, along with all posts, pages, comments, and media, will be lost.'
				)
			);
		},
		async publishPreviewSite( siteId, existingHostname, name ) {
			const { url } = await wpcom.publishPreview( siteId, existingHostname, name );
			return { url: `https://${ url }` };
		},
		deleteSnapshot: ( hostname ) => wpcom.deleteSnapshot( hostname ),
		renameSnapshot: ( hostname, name ) => wpcom.renameSnapshot( hostname, name ),
		// Studio on the web doesn't track what changed since a push or pull.
		async getPreviewStatus() {
			return { localSiteId: null, localChanged: null, previewChanged: null };
		},
		getConnectedWpcomSites: ( localSiteId ) => wpcom.getConnectedSites( localSiteId ),
		fetchSyncableWpcomSites: () => wpcom.fetchSyncableSites(),
		connectWpcomSite: ( localSiteId, site ) => wpcom.connectSite( localSiteId, site ),
		disconnectWpcomSite: ( localSiteId, remoteSiteId ) =>
			wpcom.disconnectSite( localSiteId, remoteSiteId ),
		pushSiteToLive: ( siteId, remoteSiteId, options ) =>
			wpcom.push( siteId, remoteSiteId, options ),
		pullSiteFromLive: ( siteId, remoteSiteId, options ) =>
			wpcom.pull( siteId, remoteSiteId, options ),
		onSyncActivity: ( listener ) => wpcom.onSyncActivity( listener ),
		cancelSync: ( siteId, remoteSiteId ) => wpcom.cancelSync( siteId, remoteSiteId ),
		getLatestRewindId: ( remoteSiteId ) => wpcom.getLatestRewindId( remoteSiteId ),
		listRemoteFileTree: ( remoteSiteId, rewindId, path ) =>
			wpcom.listRemoteFileTree( remoteSiteId, rewindId, path ),
		getHostingPhpVersion: ( remoteSiteId ) => wpcom.getHostingPhpVersion( remoteSiteId ),
		async listLocalFileTree( siteId, path, depth ) {
			return listFileTree( await sites.client( siteId ), path, depth );
		},
		getDirectorySize: pathSize,
		getFileSize: pathSize,
		async getIsMultisite() {
			return false;
		},
		getPublishCheckoutUrl: ( site ) => buildPublishCheckoutUrl( site ),
		onSyncConnectSite: ( listener ) => wpcom.onSyncConnectSite( listener ),
		watchForPublishedSite: ( siteId ) => wpcom.watchForPublishedSite( siteId ),

		getSessions: () => agent.getSessions(),
		getSession: ( sessionId ) => agent.getSession( sessionId ),
		updateSessionMetadata: ( sessionId, patch ) => agent.updateSessionMetadata( sessionId, patch ),
		createSession: ( siteId ) => agent.createSession( siteId ),
		continueSession: ( sessionId, prompt, options ) =>
			agent.continueSession( sessionId, prompt, options ),
		getActiveAgentRuns: () => agent.getActiveRuns(),
		setSessionModel: ( sessionId, model ) => agent.setSessionModel( sessionId, model ),
		setSessionProvider: ( sessionId, provider, model ) =>
			agent.setSessionProvider( sessionId, provider, model ),
		setSessionEnvironment: ( sessionId, environment ) =>
			agent.setSessionEnvironment( sessionId, environment ),
		interruptAgentRun: ( runId ) => agent.interrupt( runId ),
		answerAgentQuestion: ( runId, answers ) => agent.answer( runId, answers ),
		onAgentEvent: ( listener ) => agent.onEvent( listener ),
		onSessionPlacementUpdated: ( listener ) => agent.onPlacementUpdated( listener ),

		getUserPreferences: readPreferences,
		async setUserPreferences( partial ) {
			await kvUpdate< Partial< UserPreferences > >( PREFERENCES_KEY, {}, ( current ) => {
				const next: Partial< UserPreferences > = { ...current };
				for ( const [ key, value ] of Object.entries( partial ) ) {
					if ( value === null || value === undefined ) {
						delete next[ key as keyof UserPreferences ];
					} else {
						( next as Record< string, unknown > )[ key ] = value;
					}
				}
				return next;
			} );
			if ( 'hideFrontendAdminBar' in partial ) {
				await sites.refreshRuntimeSettings();
			}
		},
		async selectDefaultSiteDirectory() {
			return null;
		},
		async isCertificateTrusted() {
			return true;
		},
		async trustCertificate() {},

		async getAgentInstructions() {
			return ( await kvGet< string >( AGENT_INSTRUCTIONS_KEY ) ) ?? '';
		},
		async getAgentInstructionsEnabled() {
			return ( await kvGet< boolean >( AGENT_INSTRUCTIONS_ENABLED_KEY ) ) ?? true;
		},
		async setAgentInstructionsEnabled( enabled ) {
			await kvSet( AGENT_INSTRUCTIONS_ENABLED_KEY, enabled );
		},
		async saveAgentInstructions( content ) {
			await kvSet( AGENT_INSTRUCTIONS_KEY, content );
		},

		getAiSettings: () => agent.getAiSettings(),
		saveAnthropicApiKey: ( key ) => agent.saveAnthropicApiKey( key ),
		setAiProvider: ( provider ) => agent.setAiProvider( provider ),

		async getInstalledApps(): Promise< InstalledApps > {
			return {} as InstalledApps;
		},
		async getAppGlobals(): Promise< AppGlobals > {
			return { platform: 'browser', isWindowsStore: false };
		},

		async openSiteFolder() {
			throw new UnsupportedError( 'openSiteFolder' );
		},
		async openSiteInEditor() {
			throw new UnsupportedError( 'openSiteInEditor' );
		},
		async openSiteInTerminal() {
			throw new UnsupportedError( 'openSiteInTerminal' );
		},
		async openSiteEmailFolder() {
			throw new UnsupportedError( 'openSiteEmailFolder' );
		},
		connectPreviewFrame,
		async siteDebugLogExists( siteId ) {
			return (
				sites.runtimes.isRunning( siteId ) &&
				( await sites.client( siteId ) ).fileExists( DEBUG_LOG_PATH )
			);
		},
		async openSiteDebugLog( siteId ) {
			const tab = window.open( 'about:blank', '_blank' );
			if ( ! tab ) {
				return;
			}
			tab.opener = null;
			try {
				const log = await ( await sites.client( siteId ) ).readFileAsText( DEBUG_LOG_PATH );
				const url = URL.createObjectURL(
					new Blob( [ log ], { type: 'text/plain;charset=utf-8' } )
				);
				tab.location.href = url;
				setTimeout( () => URL.revokeObjectURL( url ), 60_000 );
			} catch ( error ) {
				tab.close();
				throw error;
			}
		},
		async openStudioLogs() {
			throw new UnsupportedError( 'openStudioLogs' );
		},

		// No analytics without a Studio host to attach the user and surface.
		async trackEvent() {},
		async openExternalUrl( url ) {
			window.open( url, '_blank', 'noopener,noreferrer' );
		},
		async getWapuuScore() {
			return readWapuuScore( WAPUU_SCORE_STORAGE_KEY );
		},
		async saveWapuuScore( score ) {
			writeWapuuScore( WAPUU_SCORE_STORAGE_KEY, score );
		},
		async popupAppMenu() {},

		async getWordPressSkillsStatusAllSites() {
			return [];
		},
		async installWordPressSkillToAllSites() {},
		async removeWordPressSkillFromAllSites() {},
		async getSiteAgentFiles() {
			return [];
		},
		async setSiteAgentFileEnabled() {},
		async removeSiteAgentFile() {},
		async openSiteAgentFile() {
			throw new UnsupportedError( 'openSiteAgentFile' );
		},

		showsAppMenuButton: false,
		async copyText( text ) {
			await navigator.clipboard.writeText( text );
		},
		// The site only exists while this tab runs it, so it opens in a viewer
		// page of this app rather than at the Playground URL. The tab opens
		// before the site starts, while the click still allows a popup.
		async openSiteUrl( siteId, relativeUrl = '' ) {
			const tab = window.open( 'about:blank', '_blank' );
			if ( ! tab ) {
				return;
			}
			tab.opener = null;
			try {
				const [ record ] = await Promise.all( [ sites.get( siteId ), sites.start( siteId ) ] );
				const viewer = new URL( '/site-viewer.html', window.location.origin );
				viewer.searchParams.set( 'origin', getSiteOrigin() );
				viewer.searchParams.set( 'scope', record.scope );
				viewer.searchParams.set( 'path', relativeUrl || '/' );
				tab.location.href = viewer.toString();
			} catch ( error ) {
				tab.close();
				throw error;
			}
		},

		reservesTrafficLightSpace: false,
		async isFullscreen() {
			return false;
		},
		onFullscreenChange: noSubscription,
		onSiteEvent: ( listener ) => sites.onEvent( listener ),
		onSnapshotEvent: ( listener ) => wpcom.onSnapshotEvent( listener ),
		...menuShortcuts,
		onAddSiteWithBlueprint: noSubscription,
		onOpenFolder: noSubscription,
		onOpenSite: noSubscription,
		onPullSite: noSubscription,
		onAiCreditsPurchased: noSubscription,
		async getOnboardingHints() {
			return ( await kvGet< OnboardingHintsState >( ONBOARDING_HINTS_KEY ) ) ?? {};
		},
		async setOnboardingHints( partial ) {
			await kvUpdate< OnboardingHintsState >( ONBOARDING_HINTS_KEY, {}, ( current ) => ( {
				...current,
				...partial,
			} ) );
		},
		onShowGettingStarted: noSubscription,
		onShowWhatsNew: noSubscription,
		async getAppUpdateStatus() {
			return { state: 'idle', currentVersion: null };
		},
		async checkForAppUpdates() {},
		async installAppUpdate() {},
		onAppUpdateStatusChanged: noSubscription,
		onAppUpdateNotAvailable: noSubscription,
	};
}
