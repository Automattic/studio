import { DEFAULT_COLOR_SCHEME } from '@studio/common/lib/user-settings/preferences';
import { fetchWordPressVersions } from '@studio/common/lib/wordpress-versions';
import {
	AGENT_INSTRUCTIONS_ENABLED_KEY,
	AGENT_INSTRUCTIONS_KEY,
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
	readWordPressVersion,
	withSitePage,
	type BlueprintBundle,
} from '@studio/static';
import { __ } from '@wordpress/i18n';
import { isShortcut } from '@/lib/keyboard';
import { buildPublishCheckoutUrl } from '../publish-checkout-url';
import { UnsupportedError } from '../unsupported-error';
import { readWapuuScore, writeWapuuScore } from '../wapuu-score-storage';
import type {
	AppGlobals,
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
	terminal: null,
	colorScheme: DEFAULT_COLOR_SCHEME,
	locale: undefined,
	analyticsEnabled: false,
	defaultSiteDirectory: '/sites',
	studioCliInstalled: false,
	studioCliExternallyManaged: false,
};

// A browser tab has no application menu, so the page binds its accelerators.
function onMenuShortcut( listener: () => void, key: string, modifier?: 'shift' ) {
	const onKeyDown = ( event: KeyboardEvent ) => {
		if ( ! event.defaultPrevented && ! event.repeat && isShortcut( event, key, modifier ) ) {
			event.preventDefault();
			listener();
		}
	};
	document.addEventListener( 'keydown', onKeyDown );
	return () => document.removeEventListener( 'keydown', onKeyDown );
}

function download( data: BlobPart, filename: string, type: string ): string {
	const url = URL.createObjectURL( new Blob( [ data ], { type } ) );
	const anchor = document.createElement( 'a' );
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild( anchor );
	anchor.click();
	anchor.remove();
	setTimeout( () => URL.revokeObjectURL( url ), 10_000 );
	return filename;
}

function backupFilename( siteName: string, extension: string ): string {
	const stamp = new Date().toISOString().replace( /[:.]/g, '-' ).slice( 0, 19 );
	return `${ siteName.replace( /[^a-z0-9-_]+/gi, '-' ) }-${ stamp }.${ extension }`;
}

/**
 * Studio on the web: the data source for a static deployment with no Studio
 * server. Sites run in WordPress Playground and persist in the browser's
 * private storage, WordPress.com is reached directly with the user's token, and
 * Studio Code runs in the page.
 */
export function createStaticConnector(): Connector {
	// Files the user picked, by the pseudo path `getFilePath` hands back.
	const pickedFiles = new Map< string, File >();
	const blueprintBundles = new Map< string, BlueprintBundle >();
	const { sites, auth, wpcom, agent } = createStaticBackend( {
		readAttachment: ( filePath ) => pickedFiles.get( filePath ),
		download,
	} );

	async function readPreferences(): Promise< UserPreferences > {
		return {
			...DEFAULT_PREFERENCES,
			...( await kvGet< Partial< UserPreferences > >( PREFERENCES_KEY ) ),
		};
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
			siteFolders: false,
			phpMyAdmin: false,
			customDomains: false,
			xdebug: false,
			siteAgentFiles: false,
			fileAccess: false,
			versionChoice: false,
		},

		agenticRequiresAuth: false,
		getAuthUser: () => auth.user(),
		authenticate: ( signup = false ) => auth.authenticate( signup ),
		logout: () => auth.signOut(),
		onAuthStateChanged: ( listener ) => auth.onChange( listener ),
		async getOnboardingCompleted() {
			return true;
		},
		async setOnboardingCompleted() {},

		getSites: () => sites.getDetails(),
		async createSite( params ) {
			const { filePath, bundleUrl } = params.blueprint ?? {};
			const bundle = filePath
				? blueprintBundles.get( filePath )
				: bundleUrl
				? await loadBlueprintBundle( bundleUrl )
				: undefined;
			const site = await sites.create( params, bundle );
			if ( filePath ) {
				blueprintBundles.delete( filePath );
			}
			return site;
		},
		deleteSite: ( id ) => sites.delete( id ),
		async copySite( sourceSiteId ) {
			const source = await sites.get( sourceSiteId );
			const names = new Set( ( await sites.list() ).map( ( site ) => site.name ) );
			let name = `${ source.name } Copy`;
			for ( let suffix = 2; names.has( name ); suffix++ ) {
				name = `${ source.name } Copy ${ suffix }`;
			}
			return sites.copy( sourceSiteId, name );
		},
		startSite: ( id ) => sites.start( id ),
		stopSite: ( id ) => sites.stop( id ),
		updateSite: ( site, wpVersion ) => sites.update( site, wpVersion ),
		updateSitesSortOrder: ( updates ) => sites.updateSortOrder( updates ),
		getSiteThumbnail: ( siteId ) => sites.getThumbnail( siteId ),
		async captureSitePreview( siteId, { path } ) {
			if ( /^\/?wp-(admin|login)/.test( path.replace( /^\/scope:[^/]+/, '' ) ) ) {
				return null;
			}
			const record = await sites.get( siteId );
			if ( ! sites.runtimes.isRunning( siteId ) ) {
				return null;
			}
			const thumbnail = await withSitePage(
				record.scope,
				path.replace( /^\/scope:[^/]+/, '' ),
				{ width: 1280, height: 800 },
				async ( page ) => ( await page.capture() ).dataUrl
			).catch( () => null );
			if ( thumbnail ) {
				await sites.setThumbnail( siteId, thumbnail );
			}
			return thumbnail;
		},
		async getSiteDesign() {
			return null;
		},
		async fixSiteDesignDrift() {
			throw new UnsupportedError( 'fixSiteDesignDrift' );
		},

		async exportFullSite( siteId ) {
			const record = await sites.get( siteId );
			const zip = await exportSiteZip( await sites.client( siteId ) );
			return download( zip as BlobPart, backupFilename( record.name, 'zip' ), 'application/zip' );
		},
		async exportDatabase( siteId ) {
			const record = await sites.get( siteId );
			const sql = await exportDatabaseSql( await sites.client( siteId ) );
			return download( sql, backupFilename( record.name, 'sql' ), 'application/sql' );
		},

		async generateProposedSitePath( siteName ) {
			return { path: await sites.uniquePath( siteName ), isEmpty: true, isWordPress: false };
		},
		async generateProposedSiteName( usedSites ) {
			return this.generateNumberedSiteName( __( 'My WordPress Website' ), usedSites );
		},
		async generateNumberedSiteName( baseName, usedSites ) {
			const used = new Set( usedSites.map( ( site ) => site.name ) );
			let name = baseName;
			for ( let suffix = 2; used.has( name ); suffix++ ) {
				name = `${ baseName } ${ suffix }`;
			}
			return name;
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
		async extractBlueprintBundle( file ) {
			if ( file.name.endsWith( '.json' ) ) {
				return {
					blueprintJson: JSON.parse( await file.text() ),
					blueprintJsonPath: '',
					tempDir: '',
				};
			}
			// A bundle stays in memory, under a pseudo path, until a site is
			// created from it.
			const bundle = await loadBlueprintBundle( file );
			const tempDir = `/blueprint-bundles/${ crypto.randomUUID() }`;
			const blueprintJsonPath = `${ tempDir }/blueprint.json`;
			blueprintBundles.set( blueprintJsonPath, bundle );
			return {
				blueprintJson: await ( await loadPlaygroundClient() ).getBlueprintDeclaration( bundle ),
				blueprintJsonPath,
				tempDir,
			};
		},
		async cleanupBlueprintTempDir( tempDir ) {
			blueprintBundles.delete( `${ tempDir }/blueprint.json` );
		},
		async readBlueprintFile() {
			throw new UnsupportedError( 'readBlueprintFile' );
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
		publishPreviewSite: ( siteId, existingHostname, name ) =>
			wpcom.publishPreview( siteId, existingHostname, name ),
		deleteSnapshot: ( hostname ) => wpcom.deleteSnapshot( hostname ),
		renameSnapshot: ( hostname, name ) => wpcom.renameSnapshot( hostname, name ),
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
		async getDirectorySize( siteId, path ) {
			return getPathSize( await sites.client( siteId ), path.join( '/' ) );
		},
		async getFileSize( siteId, path ) {
			return getPathSize( await sites.client( siteId ), path.join( '/' ) );
		},
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
			const log = await ( await sites.client( siteId ) ).readFileAsText( DEBUG_LOG_PATH );
			const url = URL.createObjectURL( new Blob( [ log ], { type: 'text/plain;charset=utf-8' } ) );
			window.open( url, '_blank', 'noopener' );
			setTimeout( () => URL.revokeObjectURL( url ), 60_000 );
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
		// page of this app rather than at the Playground URL.
		async openSiteUrl( siteId, relativeUrl = '' ) {
			const record = await sites.get( siteId );
			await sites.start( siteId );
			const viewer = new URL( '/site-viewer.html', window.location.origin );
			viewer.searchParams.set( 'origin', getSiteOrigin() );
			viewer.searchParams.set( 'scope', record.scope );
			viewer.searchParams.set( 'path', relativeUrl || '/' );
			window.open( viewer.toString(), '_blank', 'noopener' );
		},

		reservesTrafficLightSpace: false,
		async isFullscreen() {
			return false;
		},
		onFullscreenChange() {
			return () => {};
		},
		onSiteEvent: ( listener ) => sites.onEvent( listener ),
		onSnapshotEvent: ( listener ) => wpcom.onSnapshotEvent( listener ),
		onToggleSitePreview( listener ) {
			return onMenuShortcut( listener, 'b', 'shift' );
		},
		onToggleSidebar( listener ) {
			return onMenuShortcut( listener, 'b' );
		},
		onAddSite( listener ) {
			return onMenuShortcut( listener, 'n' );
		},
		onAddSiteWithBlueprint() {
			return () => {};
		},
		onOpenSettings( listener ) {
			return onMenuShortcut( () => listener( {} ), ',' );
		},
		onAiCreditsPurchased() {
			return () => {};
		},
		async getOnboardingHints() {
			return ( await kvGet< OnboardingHintsState >( ONBOARDING_HINTS_KEY ) ) ?? {};
		},
		async setOnboardingHints( partial ) {
			await kvUpdate< OnboardingHintsState >( ONBOARDING_HINTS_KEY, {}, ( current ) => ( {
				...current,
				...partial,
			} ) );
		},
		onShowGettingStarted() {
			return () => {};
		},
		onShowWhatsNew() {
			return () => {};
		},
		async getAppUpdateStatus() {
			return { state: 'idle', currentVersion: null };
		},
		async installAppUpdate() {},
		onAppUpdateStatusChanged() {
			return () => {};
		},
		onAppUpdateNotAvailable() {
			return () => {};
		},
	};
}
