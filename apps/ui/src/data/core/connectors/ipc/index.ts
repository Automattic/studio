import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import {
	STUDIO_ASSISTANT_QUOTA_URL,
	studioAssistantQuotaSchema,
} from '@studio/common/lib/studio-assistant-quota';
import { fetchWordPressVersions } from '@studio/common/lib/wordpress-versions';
import { __ } from '@wordpress/i18n';
import { buildPublishCheckoutUrl } from '../publish-checkout-url';
import type {
	ActiveAgentRun,
	AiSessionSummary,
	AiSessionPlacementUpdatedEvent,
	AppGlobals,
	AuthUser,
	ColorScheme,
	Connector,
	ExtractedBlueprintBundle,
	InstalledApps,
	LocalMediaFile,
	LoadedAiSession,
	AppUpdateStatus,
	ProposedSitePath,
	QuitSitesBehavior,
	SelectedSiteFolder,
	SiteDetails,
	SkillStatus,
	Snapshot,
	SnapshotUsage,
	StudioAssistantQuota,
	SupportedEditor,
	SupportedTerminal,
	SyncSite,
	UserPreferences,
} from '../../types';
import type { AgentRunEvent } from '@studio/common/ai/agent-events';
import type { StoredAuthToken } from '@studio/common/lib/auth-token-schema';
import type { SiteEvent } from '@studio/common/lib/cli-events';
import type { ImportEventTuple } from '@studio/common/lib/import-export-events';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

function generateBackupFilename( siteName: string ): string {
	const now = new Date();
	const pad = ( n: number ) => String( n ).padStart( 2, '0' );
	const timestamp =
		`${ now.getFullYear() }-${ pad( now.getMonth() + 1 ) }-${ pad( now.getDate() ) }` +
		`-${ pad( now.getHours() ) }-${ pad( now.getMinutes() ) }-${ pad( now.getSeconds() ) }`;
	return sanitizeFolderName( `studio-backup-${ siteName }-${ timestamp }` );
}

function parseSnapshotUsage( response: unknown ): SnapshotUsage {
	const record = response as Record< string, unknown > | null;
	if (
		! record ||
		typeof record.site_count !== 'number' ||
		typeof record.site_limit !== 'number' ||
		typeof record.site_creation_blocked !== 'boolean'
	) {
		throw new Error( 'Invalid snapshot usage response.' );
	}
	return {
		siteCount: record.site_count,
		siteLimit: record.site_limit,
		siteCreationBlocked: record.site_creation_blocked,
	};
}

/**
 * Creates a connector that delegates to the Electron IPC bridge.
 * Expects `window.ipcApi` to be exposed by the preload script.
 */
export function createIpcConnector(): Connector {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const ipcApi = ( window as any ).ipcApi;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const ipcListener = ( window as any ).ipcListener;

	if ( ! ipcApi ) {
		throw new Error(
			'IPC API not available. Are you running inside Electron with the preload script?'
		);
	}

	// The IPC connector only runs in Electron, so `navigator` reflects the
	// desktop OS.
	const isMacOS = /mac/i.test( navigator.platform || navigator.userAgent );

	// Fetches an authenticated WordPress.com endpoint with the stored OAuth
	// token. Resolves `null` when signed out so callers can degrade gracefully.
	async function fetchWpcomJson( url: string, errorLabel: string ): Promise< unknown > {
		const token = ( await ipcApi.getAuthenticationToken() ) as StoredAuthToken | null;
		if ( ! token ) {
			return null;
		}
		const response = await fetch( url, {
			headers: { Authorization: `Bearer ${ token.accessToken }` },
		} );
		if ( ! response.ok ) {
			throw new Error( `Failed to fetch ${ errorLabel }: ${ response.status }` );
		}
		return response.json();
	}

	// Preview CLI commands are path-based, not id-based. Look up the matching
	// site once per call so UI code can keep working with the stable site id.
	async function resolveSiteFolder( siteId: string ): Promise< string > {
		const sites = ( await ipcApi.getSiteDetails() ) as SiteDetails[];
		const site = sites.find( ( candidate ) => candidate.id === siteId );
		if ( ! site ) {
			throw new Error( `Site ${ siteId } not found` );
		}
		return site.path;
	}

	async function markConnectedWpcomSiteSynced(
		localSiteId: string,
		remoteSiteId: number,
		direction: 'push' | 'pull'
	): Promise< void > {
		try {
			const connectedSites = ( await ipcApi.getConnectedWpcomSites( localSiteId ) ) as SyncSite[];
			const connectedSite = connectedSites.find(
				( site ) => site.id === remoteSiteId && site.localSiteId === localSiteId
			);

			if ( ! connectedSite ) {
				return;
			}

			const timestampKey = direction === 'push' ? 'lastPushTimestamp' : 'lastPullTimestamp';
			await ipcApi.updateConnectedWpcomSites( [
				{
					...connectedSite,
					[ timestampKey ]: new Date().toISOString(),
				},
			] );
		} catch ( error ) {
			console.warn( 'Failed to update connected site sync timestamp:', error );
		}
	}

	// Bridges `createSnapshot`/`updateSnapshot`'s fire-and-forget IPC pattern
	// into an awaitable promise. The main process emits `snapshot-key-value`
	// with the final preview URL right before `snapshot-success`; fatal
	// errors arrive via `snapshot-fatal-error`. All three are broadcast to
	// every renderer subscriber, so we filter by operationId.
	function awaitSnapshotOperation( operationId: string ): Promise< { url: string } > {
		return new Promise( ( resolve, reject ) => {
			let capturedUrl: string | undefined;
			const unsubscribes: Array< () => void > = [];
			const cleanup = () => {
				for ( const unsubscribe of unsubscribes ) {
					unsubscribe();
				}
			};

			unsubscribes.push(
				ipcListener.subscribe(
					'snapshot-key-value',
					(
						_event: unknown,
						payload: { operationId: string; data: { key: string; value: string } }
					) => {
						if ( payload.operationId === operationId && payload.data.key === 'url' ) {
							capturedUrl = payload.data.value;
						}
					}
				)
			);
			unsubscribes.push(
				ipcListener.subscribe(
					'snapshot-success',
					( _event: unknown, payload: { operationId: string } ) => {
						if ( payload.operationId !== operationId ) {
							return;
						}
						cleanup();
						if ( capturedUrl ) {
							resolve( { url: capturedUrl } );
						} else {
							reject( new Error( 'Preview site command succeeded but no URL was returned.' ) );
						}
					}
				)
			);
			unsubscribes.push(
				ipcListener.subscribe(
					'snapshot-fatal-error',
					( _event: unknown, payload: { operationId: string; data: { message: string } } ) => {
						if ( payload.operationId !== operationId ) {
							return;
						}
						cleanup();
						reject( new Error( payload.data.message ) );
					}
				)
			);
		} );
	}

	return {
		async init() {
			// Install the application menu (View > Toggle DevTools, etc.).
			// The old renderer does this from its app bootstrap; the new UI
			// needs to opt in explicitly.
			await ipcApi.setupAppMenu( { needsOnboarding: false } );
		},

		// Native desktop app: every affordance is available.
		capabilities: {
			nativeFolderPicker: true,
			nativeSaveDialog: true,
			openInOS: true,
			annotatePreview: true,
			readLocalMedia: true,
			agentInstructions: true,
			switchToClassicUi: true,
		},

		// Auth — optional in Electron, delegated to main process
		requiresAuth: false,
		agenticRequiresAuth: true,

		async isAuthenticated(): Promise< boolean > {
			return ipcApi.isAuthenticated();
		},

		async getAuthUser(): Promise< AuthUser | null > {
			const token = await ipcApi.getAuthenticationToken();
			if ( ! token ) {
				return null;
			}
			return {
				id: token.id,
				email: token.email,
				displayName: token.displayName,
			};
		},

		async authenticate( signup = false ): Promise< void > {
			await ipcApi.authenticate( signup );
		},

		async logout(): Promise< void > {
			await ipcApi.clearAuthenticationToken();
		},

		onAuthStateChanged( listener ) {
			return ipcListener.subscribe( 'auth-updated', () => listener() );
		},

		async getOnboardingCompleted(): Promise< boolean > {
			return ipcApi.getOnboardingData();
		},

		async setOnboardingCompleted( completed: boolean ): Promise< void > {
			await ipcApi.saveOnboarding( completed );
		},

		// Sites
		async getSites(): Promise< SiteDetails[] > {
			return ( await ipcApi.getSiteDetails() ) as SiteDetails[];
		},

		async createSite( params ) {
			const {
				name,
				path,
				phpVersion,
				wpVersion,
				customDomain,
				enableHttps,
				adminUsername,
				adminPassword,
				adminEmail,
				blueprint,
			} = params;
			return ( await ipcApi.createSite( path, {
				siteName: name,
				phpVersion,
				wpVersion,
				customDomain,
				enableHttps,
				adminUsername,
				adminPassword,
				adminEmail,
				blueprint,
			} ) ) as SiteDetails;
		},

		async deleteSite( id, deleteFiles = true ) {
			await ipcApi.deleteSite( id, deleteFiles );
		},

		async copySite( sourceSiteId ): Promise< SiteDetails > {
			const sites = ( await ipcApi.getSiteDetails() ) as SiteDetails[];
			const sourceSite = sites.find( ( site ) => site.id === sourceSiteId );
			if ( ! sourceSite ) {
				throw new Error( 'Source site not found.' );
			}
			// `%s Copy` matches the legacy Studio flow, and the helper bumps
			// the suffix (`Copy 2`, `Copy 3`…) when earlier copies already
			// exist.
			const baseName = `${ sourceSite.name } Copy`;
			const newName = ( await ipcApi.generateNumberedNameFromList( baseName, sites ) ) as string;
			const newSiteId = crypto.randomUUID();
			return ( await ipcApi.copySite( sourceSiteId, newSiteId, newName ) ) as SiteDetails;
		},

		async generateProposedSiteName( usedSites ): Promise< string > {
			return ( await ipcApi.generateSiteNameFromList( usedSites ) ) as string;
		},

		async generateProposedSitePath( siteName ): Promise< ProposedSitePath > {
			const response = ( await ipcApi.generateProposedSitePath( siteName ) ) as {
				path: string;
				isEmpty: boolean;
				isWordPress: boolean;
				isNameTooLong?: boolean;
			};
			return {
				path: response.path,
				isEmpty: response.isEmpty,
				isWordPress: response.isWordPress,
				isNameTooLong: response.isNameTooLong,
			};
		},

		async selectSiteFolder( defaultPath ): Promise< SelectedSiteFolder | null > {
			const response = ( await ipcApi.showOpenFolderDialog(
				'Choose folder for site',
				defaultPath
			) ) as SelectedSiteFolder | null;
			return response ?? null;
		},

		async comparePaths( path1, path2 ) {
			return ( await ipcApi.comparePaths( path1, path2 ) ) as boolean;
		},

		getWordPressVersions: fetchWordPressVersions,

		async getWpVersion( siteId ) {
			return ( await ipcApi.getWpVersion( siteId ) ) as string;
		},

		async getFilePath( file ) {
			// `webUtils.getPathForFile` is a synchronous preload-only API; the
			// connector wraps it in a Promise to keep the surface uniform and
			// to leave room for non-Electron connectors that might resolve the
			// path asynchronously.
			return ( ipcApi.getPathForFile( file ) as string ) ?? '';
		},

		async readLocalMediaFile( path ): Promise< LocalMediaFile > {
			return ( await ipcApi.readLocalMediaFile( path ) ) as LocalMediaFile;
		},

		async extractBlueprintBundle( file ): Promise< ExtractedBlueprintBundle > {
			const zipFilePath = ( ipcApi.getPathForFile( file ) as string ) ?? '';
			if ( ! zipFilePath ) {
				throw new Error(
					__( 'Unable to resolve the ZIP file path. Try choosing the file via the button.' )
				);
			}
			return ( await ipcApi.extractBlueprintBundle( zipFilePath ) ) as ExtractedBlueprintBundle;
		},

		async cleanupBlueprintTempDir( tempDir ) {
			await ipcApi.cleanupBlueprintTempDir( tempDir );
		},

		async readBlueprintFile( filePath ) {
			return ipcApi.readBlueprintFile( filePath ) as Promise< BlueprintV1Declaration >;
		},

		async importSiteFromBackup( siteId, backupPath, onProgress ): Promise< void > {
			const unsubscribe = onProgress
				? ipcListener.subscribe(
						'on-import',
						( _event: unknown, importEvent: ImportEventTuple, importSiteId: string ) => {
							if ( importSiteId === siteId ) onProgress( importEvent );
						}
				  )
				: undefined;
			try {
				await ipcApi.importSite( siteId, backupPath, {
					alwaysStartServer: true,
					showErrorModal: false,
					showNotification: false,
				} );
			} finally {
				unsubscribe?.();
			}
		},

		async startSite( id ) {
			await ipcApi.startServer( id );
		},

		async stopSite( id ) {
			await ipcApi.stopServer( id );
		},

		async updateSite( site, wpVersion ) {
			await ipcApi.updateSite( site, wpVersion );
		},

		async updateSitesSortOrder( updates ) {
			await ipcApi.updateSitesSortOrder( updates );
		},

		async refreshSiteIcon( siteId ) {
			await ipcApi.loadSiteIcon( siteId );
		},

		async getSiteThumbnail( siteId ): Promise< string | null > {
			return ( await ipcApi.getThumbnailData( siteId ) ) as string | null;
		},

		async exportFullSite( siteId ): Promise< string | null > {
			const sites = ( await ipcApi.getSiteDetails() ) as SiteDetails[];
			const site = sites.find( ( candidate ) => candidate.id === siteId );
			if ( ! site ) {
				throw new Error( `Site ${ siteId } not found` );
			}
			const fileName = generateBackupFilename( site.name );
			const backupFile = ( await ipcApi.showSaveAsDialog( {
				title: __( 'Save backup file' ),
				defaultPath: `${ fileName }.zip`,
				filters: [
					{
						name: 'Compressed Backup Files',
						extensions: [ 'tar.gz', 'tzg', 'zip' ],
					},
				],
			} ) ) as string;
			if ( ! backupFile ) {
				return null;
			}
			// Success notification and error modal are shown by the main-process
			// handler, mirroring the legacy renderer's export flow.
			await ipcApi.exportSite( site.id, backupFile, {
				mode: 'full',
				showItemInFolder: true,
				showNotification: true,
			} );
			return backupFile;
		},

		async exportDatabase( siteId ): Promise< string | null > {
			const sites = ( await ipcApi.getSiteDetails() ) as SiteDetails[];
			const site = sites.find( ( candidate ) => candidate.id === siteId );
			if ( ! site ) {
				throw new Error( `Site ${ siteId } not found` );
			}
			const fileName = generateBackupFilename( site.name );
			const backupFile = ( await ipcApi.showSaveAsDialog( {
				title: __( 'Save database file' ),
				defaultPath: `${ fileName }.sql`,
				filters: [
					{
						name: 'SQL dump file',
						extensions: [ 'sql' ],
					},
				],
			} ) ) as string;
			if ( ! backupFile ) {
				return null;
			}
			await ipcApi.exportSite( site.id, backupFile, {
				mode: 'db',
				showItemInFolder: true,
				showNotification: true,
			} );
			return backupFile;
		},

		// Preview snapshots
		async getSnapshots(): Promise< Snapshot[] > {
			return ( await ipcApi.fetchSnapshots() ) as Snapshot[];
		},

		async getSnapshotUsage(): Promise< SnapshotUsage | null > {
			const data = await fetchWpcomJson(
				'https://public-api.wordpress.com/wpcom/v2/jurassic-ninja/usage',
				'snapshot usage'
			);
			return data === null ? null : parseSnapshotUsage( data );
		},

		async getStudioAssistantQuota(): Promise< StudioAssistantQuota | null > {
			const data = await fetchWpcomJson( STUDIO_ASSISTANT_QUOTA_URL, 'Studio assistant quota' );
			return data === null ? null : studioAssistantQuotaSchema.parse( data );
		},

		async deleteAllSnapshots(): Promise< void > {
			await ipcApi.deleteAllSnapshots();
		},

		async publishPreviewSite( siteId, existingHostname ): Promise< { url: string } > {
			const siteFolder = await resolveSiteFolder( siteId );
			// Reuses the desktop app's `createSnapshot`/`updateSnapshot` IPC
			// pair. Those kick off a CLI command and immediately return an
			// operationId; the actual completion is reported later via the
			// `snapshot-*` event channel, so we correlate by operationId and
			// resolve once the matching `snapshot-success` fires.
			const { operationId } = ( await ( existingHostname
				? ipcApi.updateSnapshot( siteFolder, existingHostname )
				: ipcApi.createSnapshot( siteFolder ) ) ) as { operationId: string };
			return awaitSnapshotOperation( operationId );
		},

		// Connected WPCom sites
		async getConnectedWpcomSites( localSiteId: string ): Promise< SyncSite[] > {
			return ( await ipcApi.getConnectedWpcomSites( localSiteId ) ) as SyncSite[];
		},

		async fetchSyncableWpcomSites(): Promise< SyncSite[] > {
			return ( await ipcApi.fetchSyncableWpcomSites() ) as SyncSite[];
		},

		async connectWpcomSite( localSiteId, site ): Promise< void > {
			await ipcApi.connectWpcomSites( [ { sites: [ site ], localSiteId } ] );
		},

		async disconnectWpcomSite( localSiteId, remoteSiteId ): Promise< void > {
			await ipcApi.disconnectWpcomSites( [ { siteIds: [ remoteSiteId ], localSiteId } ] );
		},

		onSyncConnectSite( listener ) {
			return ipcListener.subscribe(
				'sync-connect-site',
				(
					_event: unknown,
					payload: { remoteSiteId: number; studioSiteId: string; autoOpenPush?: boolean }
				) => listener( payload )
			);
		},

		async pushSiteToLive( siteId, remoteSiteId ): Promise< void > {
			// The agentic UI pushes via the shared `pushSite` (export → TUS
			// upload → import) in both desktop and `studio ui`; the desktop runs
			// it behind this single IPC handler. Resolves once the import is
			// initiated (the remote import may still be running).
			await ipcApi.pushSiteToLive( siteId, remoteSiteId );
			await markConnectedWpcomSiteSynced( siteId, remoteSiteId, 'push' );
		},

		async pullSiteFromLive( siteId, remoteSiteId ): Promise< void > {
			const siteFolder = await resolveSiteFolder( siteId );
			await ipcApi.pullSiteFromLive( siteFolder, remoteSiteId );
			await markConnectedWpcomSiteSynced( siteId, remoteSiteId, 'pull' );
		},

		getPublishCheckoutUrl( site ): string {
			return buildPublishCheckoutUrl( site );
		},

		// AI sessions
		async getSessions(): Promise< AiSessionSummary[] > {
			return ( await ipcApi.listAiSessions() ) as AiSessionSummary[];
		},

		async getSession( sessionId ): Promise< LoadedAiSession > {
			return ( await ipcApi.loadAiSession( sessionId ) ) as LoadedAiSession;
		},

		async deleteSession( sessionId ) {
			await ipcApi.deleteAiSession( sessionId );
		},

		async updateSessionMetadata( sessionId, patch ): Promise< AiSessionSummary > {
			return ( await ipcApi.updateAiSessionMetadata( sessionId, patch ) ) as AiSessionSummary;
		},

		async createSession( siteId ): Promise< AiSessionSummary > {
			return ( await ipcApi.createAiSession( siteId ) ) as AiSessionSummary;
		},

		async continueSession( sessionId, prompt, options ): Promise< { runId: string } > {
			return ( await ipcApi.continueAiSession( sessionId, prompt, options ) ) as {
				runId: string;
			};
		},

		async getActiveAgentRuns(): Promise< ActiveAgentRun[] > {
			return ( await ipcApi.listActiveAiAgentRuns() ) as ActiveAgentRun[];
		},

		async setSessionModel( sessionId, model ) {
			await ipcApi.setAiSessionModel( sessionId, model );
		},

		async interruptAgentRun( runId ) {
			await ipcApi.interruptAiAgentRun( runId );
		},

		async answerAgentQuestion( runId, answers ) {
			await ipcApi.answerAiAgentQuestion( runId, answers );
		},

		async setSessionEnvironment( sessionId, environment ) {
			const result = ( await ipcApi.setSessionEnvironment( sessionId, environment ) ) as {
				environment: 'local' | 'live';
				url?: string;
				wpcomSiteId?: number;
			};
			return {
				environment: result.environment,
				url: result.url,
				wpcomSiteId: result.wpcomSiteId,
			};
		},

		onAgentEvent( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe( 'ai-agent-event', ( _event: unknown, payload: AgentRunEvent ) =>
				listener( payload )
			);
		},

		onSessionPlacementUpdated( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe(
				'ai-session-placement-updated',
				( _event: unknown, payload: AiSessionPlacementUpdatedEvent ) => listener( payload )
			);
		},

		// User preferences — the underlying main-process handlers are split
		// per field; we fan out in parallel here so the UI can work with a
		// single query/mutation pair.
		async getUserPreferences(): Promise< UserPreferences > {
			const [
				editor,
				terminal,
				colorScheme,
				quitSitesBehavior,
				locale,
				analyticsEnabled,
				defaultSiteDirectory,
				studioCliInstalled,
				studioCliExternallyManaged,
				agenticFeaturesEnabled,
			] = ( await Promise.all( [
				ipcApi.getUserEditor(),
				ipcApi.getUserTerminal(),
				ipcApi.getColorScheme(),
				ipcApi.getQuitSitesBehavior(),
				ipcApi.getUserLocale(),
				ipcApi.getAnalyticsEnabled(),
				ipcApi.getDefaultSiteDirectory(),
				ipcApi.isStudioCliInstalled(),
				ipcApi.isStudioCliExternallyManaged(),
				ipcApi.getAgenticFeaturesEnabled(),
			] ) ) as [
				SupportedEditor | null,
				SupportedTerminal | null,
				ColorScheme,
				QuitSitesBehavior | undefined,
				string | undefined,
				boolean,
				string,
				boolean,
				boolean,
				boolean,
			];
			return {
				editor,
				terminal,
				colorScheme,
				quitSitesBehavior,
				locale,
				analyticsEnabled,
				defaultSiteDirectory,
				studioCliInstalled,
				studioCliExternallyManaged,
				agenticFeaturesEnabled,
			};
		},

		async setUserPreferences( partial ): Promise< void > {
			const writes: Array< Promise< unknown > > = [];
			if ( 'editor' in partial ) {
				writes.push( ipcApi.saveUserEditor( partial.editor ) );
			}
			if ( 'terminal' in partial ) {
				writes.push( ipcApi.saveUserTerminal( partial.terminal ) );
			}
			if ( 'colorScheme' in partial && partial.colorScheme ) {
				writes.push( ipcApi.saveColorScheme( partial.colorScheme ) );
			}
			if ( 'quitSitesBehavior' in partial ) {
				writes.push( ipcApi.saveQuitSitesBehavior( partial.quitSitesBehavior ) );
			}
			if ( 'locale' in partial && partial.locale ) {
				writes.push( ipcApi.saveUserLocale( partial.locale ) );
			}
			if ( 'analyticsEnabled' in partial ) {
				writes.push( ipcApi.saveAnalyticsEnabled( partial.analyticsEnabled ) );
			}
			if ( 'defaultSiteDirectory' in partial && partial.defaultSiteDirectory ) {
				writes.push( ipcApi.saveDefaultSiteDirectory( partial.defaultSiteDirectory ) );
			}
			if ( 'studioCliInstalled' in partial && typeof partial.studioCliInstalled === 'boolean' ) {
				writes.push(
					partial.studioCliInstalled ? ipcApi.installStudioCli() : ipcApi.uninstallStudioCli()
				);
			}
			if ( typeof partial.agenticFeaturesEnabled === 'boolean' ) {
				writes.push( ipcApi.saveAgenticFeaturesEnabled( partial.agenticFeaturesEnabled ) );
			}
			await Promise.all( writes );
		},

		async selectDefaultSiteDirectory( defaultPath ): Promise< string | null > {
			const response = ( await ipcApi.showOpenFolderDialog(
				__( 'Select default site directory' ),
				defaultPath
			) ) as { path?: string } | string | null;
			if ( typeof response === 'string' ) {
				return response || null;
			}
			return response?.path ?? null;
		},

		async getAgentInstructions(): Promise< string > {
			return ( await ipcApi.getGlobalAgentInstructions() ) as string;
		},
		async saveAgentInstructions( content: string ): Promise< void > {
			await ipcApi.saveGlobalAgentInstructions( content );
		},

		async getInstalledApps(): Promise< InstalledApps > {
			return ( await ipcApi.getInstalledAppsAndTerminals() ) as InstalledApps;
		},

		async getAppGlobals(): Promise< AppGlobals > {
			return ( await ipcApi.getAppGlobals() ) as AppGlobals;
		},

		async openSiteFolder( siteId ): Promise< void > {
			const sitePath = await resolveSiteFolder( siteId );
			ipcApi.openLocalPath( sitePath );
		},

		async openSiteInEditor( siteId ): Promise< void > {
			const sitePath = await resolveSiteFolder( siteId );
			const editor = ( await ipcApi.getUserEditor() ) as SupportedEditor | null;
			if ( ! editor ) {
				throw new Error( 'No preferred editor configured.' );
			}
			await ipcApi.openAppAtPath( editor, sitePath );
		},

		async openSiteInTerminal( siteId ): Promise< void > {
			const sitePath = await resolveSiteFolder( siteId );
			await ipcApi.openTerminalAtPath( sitePath );
		},

		// Analytics
		async trackEvent( eventName, props = {} ): Promise< void > {
			await ipcApi.recordAnalyticsEvent( eventName, {
				channel: 'studio-ui',
				ui_version: 'v2',
				...props,
			} );
		},

		// External links
		async openExternalUrl( url: string ): Promise< void > {
			ipcApi.openURL( url );
		},

		async getWapuuScore(): Promise< number | undefined > {
			return ( await ipcApi.getWapuuScore() ) as number | undefined;
		},
		async saveWapuuScore( score: number ): Promise< void > {
			await ipcApi.saveWapuuScore( score );
		},

		async popupAppMenu( position: { x: number; y: number } ): Promise< void > {
			ipcApi.popupAppMenu( position );
		},

		// Windows/Linux have no native menu bar, so the UI provides the entry
		// point; macOS keeps the native application menu.
		showsAppMenuButton: ! isMacOS,

		async copyText( text: string ): Promise< void > {
			await ipcApi.copyText( text );
		},

		async confirmDeleteAllPreviewSites(): Promise< boolean > {
			const CANCEL_BUTTON_INDEX = 0;
			const DELETE_BUTTON_INDEX = 1;
			const { response } = ( await ipcApi.showMessageBox( {
				type: 'warning',
				message: __( 'Delete all preview sites' ),
				detail: __(
					'All preview sites that exist for your WordPress.com account, along with all posts, pages, comments, and media, will be lost.'
				),
				buttons: [ __( 'Cancel' ), __( 'Delete all' ) ],
				cancelId: CANCEL_BUTTON_INDEX,
			} ) ) as { response: number };
			return response === DELETE_BUTTON_INDEX;
		},

		async openSiteUrl( siteId, relativeUrl = '', options ): Promise< void > {
			await ipcApi.openSiteURL( siteId, relativeUrl, options );
		},

		async getWordPressSkillsStatusAllSites(): Promise< SkillStatus[] > {
			return ( await ipcApi.getWordPressSkillsStatusAllSites() ) as SkillStatus[];
		},

		async installWordPressSkillToAllSites( skillId: string ): Promise< void > {
			await ipcApi.installWordPressSkillsToAllSites( { skillId } );
		},

		async removeWordPressSkillFromAllSites( skillId: string ): Promise< void > {
			await ipcApi.removeWordPressSkillFromAllSites( skillId );
		},

		// Window state
		// macOS overlays the traffic lights on the content (so we reserve
		// space for them); Windows and Linux don't.
		reservesTrafficLightSpace: isMacOS,

		async isFullscreen(): Promise< boolean > {
			return ipcApi.isFullscreen();
		},

		onFullscreenChange( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe(
				'window-fullscreen-change',
				( _event: unknown, fullscreen: boolean ) => listener( fullscreen )
			);
		},

		onSiteEvent( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe( 'site-event', ( _event: unknown, siteEvent: SiteEvent ) =>
				listener( siteEvent )
			);
		},

		onToggleSitePreview( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe( 'toggle-site-preview', () => listener() );
		},

		onToggleSidebar( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe( 'toggle-sidebar', () => listener() );
		},

		onAddSite( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe( 'add-site', () => listener() );
		},

		onAddSiteWithBlueprint( listener ) {
			return ipcListener.subscribe(
				'add-site-with-blueprint',
				( _event: unknown, payload: { blueprintPath: string } ) => listener( payload )
			);
		},

		onOpenSettings( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe( 'user-settings', () => listener() );
		},

		async disableAgenticUi(): Promise< void > {
			await ipcApi.disableAgenticUi();
		},

		async getAppUpdateStatus() {
			return ipcApi.getAppUpdateStatus();
		},

		async installAppUpdate(): Promise< void > {
			await ipcApi.installAppUpdate();
		},

		onAppUpdateStatusChanged( listener ) {
			return ipcListener.subscribe( 'app-update-status', ( _event: unknown, status: unknown ) =>
				listener( status as AppUpdateStatus )
			);
		},
	};
}
