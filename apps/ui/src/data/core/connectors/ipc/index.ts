import type { AgentRunEvent } from '../../agent-events';
import type {
	AiSessionSummary,
	AuthUser,
	ColorScheme,
	Connector,
	ExtractedBlueprintBundle,
	FeaturedBlueprint,
	InstalledApps,
	LoadedAiSession,
	ProposedSitePath,
	SelectedSiteFolder,
	SiteDetails,
	Snapshot,
	SupportedEditor,
	SupportedTerminal,
	SyncSite,
	UserPreferences,
} from '../../types';

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

		// Auth — optional in Electron, delegated to main process
		requiresAuth: false,

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

		async authenticate(): Promise< void > {
			await ipcApi.authenticate( false );
		},

		async logout(): Promise< void > {
			await ipcApi.clearAuthenticationToken();
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

		async getAllCustomDomains(): Promise< string[] > {
			return ( await ipcApi.getAllCustomDomains() ) as string[];
		},

		async getFeaturedBlueprints( locale ) {
			const url = new URL( 'https://public-api.wordpress.com/wpcom/v2/studio-app/blueprints' );
			if ( locale ) {
				url.searchParams.set( 'locale', locale );
			}
			const response = await fetch( url.toString() );
			if ( ! response.ok ) {
				throw new Error( `Failed to fetch blueprints: ${ response.status }` );
			}
			const body = ( await response.json() ) as {
				blueprints?: Array< {
					slug?: string;
					title?: string;
					excerpt?: string;
					image?: string;
					playground_url?: string;
					blueprint?: unknown;
				} >;
			};
			// Drop any blueprint missing the fields the UI relies on rather
			// than failing the whole request — matches the desktop app's
			// tolerant `transformResponse` behaviour.
			const list: FeaturedBlueprint[] = [];
			for ( const item of body.blueprints ?? [] ) {
				if (
					typeof item.slug !== 'string' ||
					typeof item.title !== 'string' ||
					typeof item.excerpt !== 'string' ||
					typeof item.image !== 'string' ||
					typeof item.playground_url !== 'string' ||
					! item.blueprint ||
					typeof item.blueprint !== 'object'
				) {
					continue;
				}
				list.push( {
					slug: item.slug,
					title: item.title,
					excerpt: item.excerpt,
					image: item.image,
					playgroundUrl: item.playground_url,
					blueprint: item.blueprint as FeaturedBlueprint[ 'blueprint' ],
				} );
			}
			return list;
		},

		async getFilePath( file ) {
			// `webUtils.getPathForFile` is a synchronous preload-only API; the
			// connector wraps it in a Promise to keep the surface uniform and
			// to leave room for non-Electron connectors that might resolve the
			// path asynchronously.
			return ( ipcApi.getPathForFile( file ) as string ) ?? '';
		},

		async extractBlueprintBundle( zipFilePath ): Promise< ExtractedBlueprintBundle > {
			return ( await ipcApi.extractBlueprintBundle( zipFilePath ) ) as ExtractedBlueprintBundle;
		},

		async cleanupBlueprintTempDir( tempDir ) {
			await ipcApi.cleanupBlueprintTempDir( tempDir );
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

		async getXdebugEnabledSite() {
			return ( await ipcApi.getXdebugEnabledSite() ) as SiteDetails | null;
		},

		// Preview snapshots
		async getSnapshots(): Promise< Snapshot[] > {
			return ( await ipcApi.fetchSnapshots() ) as Snapshot[];
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
			// Mirrors the desktop app's `pushSiteThunk` — export a backup, then
			// TUS-upload it + initiate the remote import. We skip the
			// post-upload polling that the desktop app uses for progress UI;
			// `pushArchive` only resolves after `import/initiate` succeeds, so
			// the remote import may still be running when this returns.
			const operationId = window.crypto.randomUUID();
			const { archivePath } = ( await ipcApi.exportSiteForPush( siteId, operationId, {} ) ) as {
				archivePath: string;
			};
			const result = ( await ipcApi.pushArchive( siteId, remoteSiteId, archivePath ) ) as {
				success: boolean;
				error?: string;
			};
			if ( ! result.success ) {
				throw new Error( result.error ?? 'Push failed' );
			}
		},

		async pullSiteFromLive( siteId, remoteSiteId ): Promise< void > {
			const siteFolder = await resolveSiteFolder( siteId );
			await ipcApi.pullSiteFromLive( siteFolder, remoteSiteId );
		},

		getPublishCheckoutUrl( site ): string {
			const url = new URL( 'https://wordpress.com/setup/new-hosted-site' );
			url.searchParams.set( 'ref', 'studio' );
			url.searchParams.set( 'section', 'publish-site' );
			url.searchParams.set( 'showDomainStep', 'true' );
			url.searchParams.set( 'studioSiteId', site.id );
			url.searchParams.set( 'new', site.customDomain ?? site.name );
			url.searchParams.set( 'autoOpenPush', 'true' );
			return url.toString();
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

		async createSession( siteId ): Promise< AiSessionSummary > {
			return ( await ipcApi.createAiSession( siteId ) ) as AiSessionSummary;
		},

		async continueSession( sessionId, prompt ): Promise< { runId: string } > {
			return ( await ipcApi.continueAiSession( sessionId, prompt ) ) as { runId: string };
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

		// User preferences — the underlying main-process handlers are split
		// per field; we fan out in parallel here so the UI can work with a
		// single query/mutation pair.
		async getUserPreferences(): Promise< UserPreferences > {
			const [ editor, terminal, colorScheme, locale ] = ( await Promise.all( [
				ipcApi.getUserEditor(),
				ipcApi.getUserTerminal(),
				ipcApi.getColorScheme(),
				ipcApi.getUserLocale(),
			] ) ) as [
				SupportedEditor | null,
				SupportedTerminal | null,
				ColorScheme,
				string | undefined,
			];
			return { editor, terminal, colorScheme, locale };
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
			if ( 'locale' in partial && partial.locale ) {
				writes.push( ipcApi.saveUserLocale( partial.locale ) );
			}
			await Promise.all( writes );
		},

		async getInstalledApps(): Promise< InstalledApps > {
			return ( await ipcApi.getInstalledAppsAndTerminals() ) as InstalledApps;
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

		// External links
		async openExternalUrl( url: string ): Promise< void > {
			ipcApi.openURL( url );
		},

		// Window state
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
			return ipcListener.subscribe( 'site-event', () => listener() );
		},
	};
}
