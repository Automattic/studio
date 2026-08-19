import { getAuthenticationUrl, getSignUpUrl } from '@studio/common/lib/oauth';
import { SyncCancelledError } from '@studio/common/lib/sync/cancel';
import { fetchWordPressVersions } from '@studio/common/lib/wordpress-versions';
import { __ } from '@wordpress/i18n';
import { readOnboardingHints, writeOnboardingHints } from '../browser-onboarding-hints';
import { readLastSeenVersion, writeLastSeenVersion } from '../browser-whats-new';
import { buildPublishCheckoutUrl } from '../publish-checkout-url';
import { UnsupportedError } from '../unsupported-error';
import { readWapuuScore, writeWapuuScore } from '../wapuu-score-storage';
import type {
	ActiveAgentRun,
	AiSessionPlacementUpdatedEvent,
	AiSessionSummary,
	AppGlobals,
	AuthUser,
	Connector,
	ExtractedBlueprintBundle,
	InstalledApps,
	LoadedAiSession,
	LocalMediaFile,
	ProposedSitePath,
	PullSiteProgress,
	SelectedSiteFolder,
	SiteDetails,
	Snapshot,
	SnapshotUsage,
	StudioAssistantQuota,
	SyncSite,
	UserPreferences,
} from '../../types';
import type { AgentRunEvent } from '@studio/common/ai/agent-events';
import type { AiProviderId, AiSettings } from '@studio/common/ai/providers';
import type { ImportEventTuple } from '@studio/common/lib/import-export-events';
import type { PushOutput } from '@studio/common/types/sync';

const WAPUU_SCORE_STORAGE_KEY = 'studio-local-wapuu-score';

type ServerUserPreferences = Omit<
	UserPreferences,
	'studioCliInstalled' | 'studioCliExternallyManaged'
>;

export interface LocalConnectorOptions {
	// Base URL of the local Studio server started by `studio ui`, e.g.
	// http://localhost:8081.
	apiBaseUrl: string;
}

// One snapshot (preview-site) command's progress, correlated by operationId —
// the browser-side view of the server's shared SnapshotOutput. Only the fields
// the connector reacts to are modelled.
type SnapshotSseOutput =
	| { kind: 'key-value'; operationId: string; data: { key: string; value: string } }
	| { kind: 'fatal-error'; operationId: string; data: { message: string } }
	| { kind: 'success'; operationId: string }
	| { kind: 'output' | 'error'; operationId: string };

type PullProgressSseOutput = PullSiteProgress & {
	siteId: string;
	remoteSiteId: number;
};
type ImportSseOutput = { siteId: string; event: ImportEventTuple };
type PushSseOutput = PushOutput & { siteId: string; remoteSiteId: number };

// Envelope used by the backend's `/events` SSE stream so a single connection
// can carry every live update consumed by the browser UI.
type ServerEvent =
	| { channel: 'agent'; payload: AgentRunEvent }
	| { channel: 'placement'; payload: AiSessionPlacementUpdatedEvent }
	| { channel: 'snapshot'; payload: SnapshotSseOutput }
	| { channel: 'sync-pull'; payload: PullProgressSseOutput }
	| { channel: 'sync-push'; payload: PushSseOutput }
	| { channel: 'import'; payload: ImportSseOutput }
	| { channel: 'sync-connect'; payload: { remoteSiteId: number; studioSiteId: string } };

/**
 * The `studio ui` data source: the browser analog of the Electron IPC
 * connector, talking to the local server (`apps/local`, bundled into and
 * launched by the Studio CLI) over HTTP + SSE instead of IPC.
 *
 * Unlike the {@link createHostedConnector} (which targets a cloud backend and
 * WordPress.com sites), this connector points at the user's own machine: the
 * server delegates to the local Studio CLI, so the same business logic the
 * desktop app runs is reachable here. The capabilities that depend on the local
 * machine (the real site list, start/stop, the agent) are implemented for real;
 * the rest grow in later increments (site create/export land in Phase 2).
 */
export function createLocalConnector( { apiBaseUrl }: LocalConnectorOptions ): Connector {
	// The server namespaces its API under /api so the SPA's real-path routes
	// (also /sessions/:id, /sites/:id) can share the same origin.
	const base = `${ apiBaseUrl.replace( /\/$/, '' ) }/api`;

	const agentListeners = new Set< ( event: AgentRunEvent ) => void >();
	const placementListeners = new Set< ( event: AiSessionPlacementUpdatedEvent ) => void >();
	const snapshotListeners = new Set< ( output: SnapshotSseOutput ) => void >();
	const pullProgressListeners = new Set< ( output: PullProgressSseOutput ) => void >();
	const pushOutputListeners = new Set< ( output: PushSseOutput ) => void >();
	const importListeners = new Set< ( output: ImportSseOutput ) => void >();
	const syncConnectListeners = new Set<
		( event: { remoteSiteId: number; studioSiteId: string } ) => void
	>();
	let eventSource: EventSource | undefined;
	// Last site list fetched via getSites(), so one-off lookups (openSiteUrl)
	// don't trigger an extra round-trip.
	let lastSites: SiteDetails[] | undefined;

	async function api< T >( path: string, init?: RequestInit ): Promise< T > {
		const response = await fetch( `${ base }${ path }`, {
			...init,
			headers: {
				'Content-Type': 'application/json',
				...init?.headers,
			},
		} );
		if ( ! response.ok ) {
			const text = await response.text().catch( () => '' );
			// Server errors carry a user-facing `{ error }` body — surface that
			// message directly instead of the transport line.
			let serverError: string | undefined;
			try {
				const payload: unknown = JSON.parse( text );
				if ( payload && typeof payload === 'object' && 'error' in payload ) {
					serverError = typeof payload.error === 'string' ? payload.error : undefined;
				}
			} catch {
				// Not JSON; fall through to the transport error.
			}
			throw new Error(
				serverError ??
					`${ init?.method ?? 'GET' } ${ path } failed (${ response.status }): ${ text }`
			);
		}
		if ( response.status === 204 ) {
			return undefined as T;
		}
		return ( await response.json() ) as T;
	}

	// Fetch a server endpoint that returns a file and save it via the browser's
	// download mechanism — the browser-friendly substitute for a native Save-As
	// dialog. Returns the saved filename.
	async function downloadFromServer( endpoint: string ): Promise< string > {
		const response = await fetch( `${ base }${ endpoint }` );
		if ( ! response.ok ) {
			const text = await response.text().catch( () => '' );
			throw new Error( `GET ${ endpoint } failed (${ response.status }): ${ text }` );
		}
		const disposition = response.headers.get( 'Content-Disposition' ) ?? '';
		const filename = /filename="?([^"]+)"?/.exec( disposition )?.[ 1 ] ?? 'download';
		const blob = await response.blob();
		const url = URL.createObjectURL( blob );
		const anchor = document.createElement( 'a' );
		anchor.href = url;
		anchor.download = filename;
		document.body.appendChild( anchor );
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL( url );
		return filename;
	}

	// Upload a File's bytes and get back a server-side temp path — the browser
	// substitute for an Electron filesystem path. Path-based operations (import a
	// backup, attach a file for the agent) then work just as on the desktop.
	async function uploadFile( file: File ): Promise< string > {
		const response = await fetch( `${ base }/uploads?name=${ encodeURIComponent( file.name ) }`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/octet-stream' },
			body: file,
		} );
		if ( ! response.ok ) {
			const text = await response.text().catch( () => '' );
			throw new Error( `POST /uploads failed (${ response.status }): ${ text }` );
		}
		return ( ( await response.json() ) as { path: string } ).path;
	}

	function findSiteUrl( sites: SiteDetails[], siteId: string ): string {
		const site = sites.find( ( candidate ) => candidate.id === siteId );
		if ( ! site?.url ) {
			throw new Error( `Site ${ siteId } has no URL` );
		}
		return site.url;
	}

	// Resolve when the snapshot command with this operationId finishes, with its
	// published URL — correlating the `snapshot` SSE stream by operationId, the
	// same way the IPC connector correlates the snapshot-* events.
	function awaitSnapshotOperation( operationId: string ): Promise< { url: string } > {
		return new Promise( ( resolve, reject ) => {
			let capturedUrl: string | undefined;
			const listener = ( output: SnapshotSseOutput ) => {
				if ( output.operationId !== operationId ) {
					return;
				}
				if ( output.kind === 'key-value' && output.data.key === 'url' ) {
					capturedUrl = output.data.value;
				} else if ( output.kind === 'success' ) {
					snapshotListeners.delete( listener );
					if ( capturedUrl ) {
						resolve( { url: capturedUrl } );
					} else {
						reject( new Error( 'Preview site command succeeded but no URL was returned.' ) );
					}
				} else if ( output.kind === 'fatal-error' ) {
					snapshotListeners.delete( listener );
					reject( new Error( output.data.message ) );
				}
			};
			snapshotListeners.add( listener );
		} );
	}

	return {
		async init() {
			// The browser's EventSource reconnects automatically.
			eventSource?.close();
			eventSource = new EventSource( `${ base }/events` );
			eventSource.onmessage = ( message ) => {
				let parsed: ServerEvent;
				try {
					parsed = JSON.parse( message.data ) as ServerEvent;
				} catch {
					return;
				}
				if ( parsed.channel === 'agent' ) {
					agentListeners.forEach( ( listener ) => listener( parsed.payload ) );
				} else if ( parsed.channel === 'placement' ) {
					placementListeners.forEach( ( listener ) => listener( parsed.payload ) );
				} else if ( parsed.channel === 'snapshot' ) {
					snapshotListeners.forEach( ( listener ) => listener( parsed.payload ) );
				} else if ( parsed.channel === 'sync-pull' ) {
					pullProgressListeners.forEach( ( listener ) => listener( parsed.payload ) );
				} else if ( parsed.channel === 'sync-push' ) {
					pushOutputListeners.forEach( ( listener ) => listener( parsed.payload ) );
				} else if ( parsed.channel === 'import' ) {
					importListeners.forEach( ( listener ) => listener( parsed.payload ) );
				} else if ( parsed.channel === 'sync-connect' ) {
					syncConnectListeners.forEach( ( listener ) => listener( parsed.payload ) );
				}
			};
		},

		// Browser served by the local CLI: no native file dialogs, but the server
		// runs on the user's machine so it can still open paths in OS apps. The
		// preview is a cross-origin iframe, so the annotation inspector can't run.
		capabilities: {
			nativeFolderPicker: false,
			nativeSaveDialog: false,
			openInOS: true,
			annotatePreview: false,
			readLocalMedia: false,
			agentInstructions: true,
			aiSettings: true,
			studioLogs: false,
			switchToClassicUi: false,
		},

		// Auth — surfaces the WordPress.com user the CLI is already logged in as
		// (read from the shared auth token by the server). The app isn't gated on
		// it, but the user menu should show the real account.
		requiresAuth: false,
		agenticRequiresAuth: false,
		async isAuthenticated() {
			return ( await api< AuthUser | null >( '/auth/user' ) ) !== null;
		},
		async getAuthUser(): Promise< AuthUser | null > {
			return api< AuthUser | null >( '/auth/user' );
		},
		// Redirect-based WordPress.com login when the server has an OAuth client
		// configured: a popup goes through WordPress.com to /auth/callback, which
		// stores the token and posts back here. Falls back to the paste flow
		// (`studio auth login`-style) when no client is configured.
		async authenticate( signup = false ) {
			// Open the popup synchronously (inside the click gesture) so it isn't
			// blocked, then navigate it once the authorize URL is resolved.
			const popup = window.open( 'about:blank', 'studio-auth', 'width=600,height=720' );

			let loginUrl: string | null = null;
			try {
				( { url: loginUrl } = await api< { url: string | null } >(
					`/auth/login-url?redirect_uri=${ encodeURIComponent(
						`${ window.location.origin }/auth/callback`
					) }${ signup ? '&signup=1' : '' }`
				) );
			} catch {
				loginUrl = null;
			}

			if ( ! loginUrl ) {
				// No OAuth client configured → paste-the-token fallback.
				popup?.close();
				const redirectUri = 'https://developer.wordpress.com/copy-oauth-token';
				window.open(
					signup ? getSignUpUrl( 'en', redirectUri ) : getAuthenticationUrl( 'en', redirectUri ),
					'_blank',
					'noopener,noreferrer'
				);
				const token = window.prompt(
					__( 'After approving access on WordPress.com, paste the authentication token here:' )
				);
				if ( token?.trim() ) {
					await api( '/auth/login', {
						method: 'POST',
						body: JSON.stringify( { token: token.trim() } ),
					} );
				}
				return;
			}

			if ( popup ) {
				popup.location.href = loginUrl;
			} else {
				window.open( loginUrl, '_blank', 'noopener,noreferrer' );
			}

			// Wait for the callback page to report success (it has already stored the
			// token server-side); resolve quietly if the user closes the popup.
			await new Promise< void >( ( resolve, reject ) => {
				function onMessage( event: MessageEvent ) {
					if ( event.origin !== window.location.origin || ! event.data ) {
						return;
					}
					if ( event.data.type === 'studio-auth-success' ) {
						cleanup();
						resolve();
					} else if ( event.data.type === 'studio-auth-error' ) {
						cleanup();
						reject( new Error( event.data.message || 'Login failed' ) );
					}
				}
				window.addEventListener( 'message', onMessage );
				const closedTimer = setInterval( () => {
					if ( popup?.closed ) {
						cleanup();
						resolve();
					}
				}, 500 );
				function cleanup() {
					window.removeEventListener( 'message', onMessage );
					clearInterval( closedTimer );
				}
			} );
		},
		async logout() {
			await api( '/auth/logout', { method: 'POST' } );
		},
		onAuthStateChanged() {
			return () => {};
		},
		async getOnboardingCompleted() {
			return true;
		},
		async setOnboardingCompleted() {
			// No-op.
		},

		// Sites — the local machine's real Studio sites, served by the CLI.
		async getSites(): Promise< SiteDetails[] > {
			lastSites = await api< SiteDetails[] >( '/sites' );
			return lastSites;
		},
		async startSite( id ) {
			await api( `/sites/${ encodeURIComponent( id ) }/start`, { method: 'POST' } );
		},
		async stopSite( id ) {
			await api( `/sites/${ encodeURIComponent( id ) }/stop`, { method: 'POST' } );
		},
		async refreshSiteIcon() {
			// No-op: icons come back with getSites().
		},
		async getSiteThumbnail(): Promise< string | null > {
			return null;
		},
		async getSiteStorageUsage( siteId ) {
			return api( `/sites/${ encodeURIComponent( siteId ) }/storage` );
		},

		// Site creation — delegated to the CLI `create` on the local machine.
		async createSite( params ): Promise< SiteDetails > {
			return api< SiteDetails >( '/sites', {
				method: 'POST',
				body: JSON.stringify( {
					name: params.name,
					path: params.path,
					phpVersion: params.phpVersion,
					wpVersion: params.wpVersion,
					customDomain: params.customDomain,
					enableHttps: params.enableHttps,
					adminUsername: params.adminUsername,
					adminPassword: params.adminPassword,
					adminEmail: params.adminEmail,
					skipStart: params.skipStart,
					// The server writes this to a temp file and passes --blueprint to
					// the CLI (featured blueprint JSON, or an uploaded bundle's filePath).
					blueprint: params.blueprint,
				} ),
			} );
		},
		async generateProposedSiteName(): Promise< string > {
			// The server derives this from its own (authoritative) site list.
			const { name } = await api< { name: string } >( '/site-defaults/name' );
			return name;
		},
		async generateNumberedSiteName( baseName ): Promise< string > {
			const { name } = await api< { name: string } >(
				`/site-defaults/name?base=${ encodeURIComponent( baseName ) }`
			);
			return name;
		},
		async generateProposedSitePath( siteName ): Promise< ProposedSitePath > {
			return api< ProposedSitePath >(
				`/site-defaults/path?name=${ encodeURIComponent( siteName ) }`
			);
		},
		async selectSiteFolder(): Promise< SelectedSiteFolder | null > {
			// No native folder picker in a browser; the create form falls back to
			// an editable path field (see capabilities.nativeFolderPicker).
			return null;
		},
		async selectDefaultSiteDirectory(): Promise< string | null > {
			// No native folder picker in a browser.
			return null;
		},
		async comparePaths( path1, path2 ) {
			const { equal } = await api< { equal: boolean } >( '/paths/compare', {
				method: 'POST',
				body: JSON.stringify( { path1, path2 } ),
			} );
			return equal;
		},

		// Delete a site via the CLI; `deleteFiles` defaults to true (the CLI's
		// own default), so only forward the override when the caller opts out.
		async deleteSite( id, deleteFiles ) {
			const query = deleteFiles === false ? '?deleteFiles=false' : '';
			await api( `/sites/${ encodeURIComponent( id ) }${ query }`, { method: 'DELETE' } );
		},
		// Duplicate a site; the server picks the numbered name + new id and copies
		// the files, mirroring the desktop's copy flow.
		async copySite( sourceSiteId ): Promise< SiteDetails > {
			return api< SiteDetails >( `/sites/${ encodeURIComponent( sourceSiteId ) }/copy`, {
				method: 'POST',
			} );
		},
		// Edit site settings — the server diffs against the current site and runs
		// the CLI `site set`, the same path the desktop takes.
		async updateSite( site, wpVersion ) {
			await api( `/sites/${ encodeURIComponent( site.id ) }/update`, {
				method: 'POST',
				body: JSON.stringify( { site, wpVersion } ),
			} );
		},
		async updateSitesSortOrder( updates ) {
			await api( '/sites/sort-order', { method: 'POST', body: JSON.stringify( { updates } ) } );
		},
		// Export downloads the archive in the browser (no native Save-As dialog).
		async exportFullSite( siteId ): Promise< string | null > {
			return downloadFromServer( `/sites/${ encodeURIComponent( siteId ) }/export?mode=full` );
		},
		async exportDatabase( siteId ): Promise< string | null > {
			return downloadFromServer( `/sites/${ encodeURIComponent( siteId ) }/export?mode=database` );
		},

		getWordPressVersions: fetchWordPressVersions,

		async getWpVersion( siteId ) {
			const { wpVersion } = await api< { wpVersion: string } >(
				`/sites/${ encodeURIComponent( siteId ) }/wp-version`
			);
			return wpVersion;
		},

		async getFilePath( file ) {
			// No real filesystem path in a browser, so upload the bytes and hand
			// back the server-side temp path the path-based operations expect.
			return uploadFile( file );
		},
		async readLocalMediaFile(): Promise< LocalMediaFile > {
			// Not exposed over HTTP: reading an arbitrary local file by absolute
			// path is an arbitrary-read risk and nothing consumes it yet. Reinstate
			// with a server-side path-containment policy when a real consumer lands.
			throw new UnsupportedError( 'readLocalMediaFile' );
		},
		async extractBlueprintBundle( file ): Promise< ExtractedBlueprintBundle > {
			const response = await fetch( `${ base }/blueprints/extract`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: file,
			} );
			if ( ! response.ok ) {
				const text = await response.text().catch( () => '' );
				throw new Error( `POST /blueprints/extract failed (${ response.status }): ${ text }` );
			}
			return ( await response.json() ) as ExtractedBlueprintBundle;
		},
		async cleanupBlueprintTempDir( tempDir ) {
			await api( '/blueprints/cleanup', {
				method: 'POST',
				body: JSON.stringify( { tempDir } ),
			} );
		},
		async readBlueprintFile() {
			throw new UnsupportedError( 'readBlueprintFile' );
		},
		async importSiteFromBackup( siteId, backupPath, onProgress ): Promise< void > {
			const listener = onProgress
				? ( output: ImportSseOutput ) => {
						if ( output.siteId === siteId ) onProgress( output.event );
				  }
				: undefined;
			if ( listener ) importListeners.add( listener );
			try {
				await api< void >( `/sites/${ encodeURIComponent( siteId ) }/import`, {
					method: 'POST',
					body: JSON.stringify( { path: backupPath } ),
				} );
			} finally {
				if ( listener ) importListeners.delete( listener );
			}
		},

		// Preview snapshots + WordPress.com sync — backed by the server's snapshot
		// manager and sync routes (the same shared code the desktop uses).
		async getSnapshots(): Promise< Snapshot[] > {
			return api< Snapshot[] >( '/snapshots' );
		},
		async getSnapshotUsage(): Promise< SnapshotUsage | null > {
			// No usage endpoint on the local server yet; callers fall back to
			// counting snapshots.
			return null;
		},
		async getStudioAssistantQuota() {
			// The server proxies the WordPress.com quota endpoint and returns
			// the already-parsed shape (or null when signed out).
			return api< StudioAssistantQuota | null >( '/quota' );
		},
		async deleteAllSnapshots() {
			// No-op: the local server has no delete-all route yet.
		},
		async publishPreviewSite( siteId, existingHostname ): Promise< { url: string } > {
			// A hostname means "refresh this preview"; otherwise create a new one.
			// The server returns an operationId; progress + the final URL arrive on
			// the `snapshot` SSE channel.
			const { operationId } = await api< { operationId: string } >(
				`/sites/${ encodeURIComponent( siteId ) }/preview`,
				{ method: 'POST', body: JSON.stringify( { hostname: existingHostname } ) }
			);
			return awaitSnapshotOperation( operationId );
		},
		async getConnectedWpcomSites( localSiteId ): Promise< SyncSite[] > {
			return api< SyncSite[] >(
				localSiteId
					? `/sites/${ encodeURIComponent( localSiteId ) }/connected-sites`
					: '/wpcom/connected-sites'
			);
		},
		async fetchSyncableWpcomSites(): Promise< SyncSite[] > {
			return api< SyncSite[] >( '/wpcom/syncable-sites' );
		},
		async connectWpcomSite( localSiteId, site ) {
			await api( `/sites/${ encodeURIComponent( localSiteId ) }/connected-sites`, {
				method: 'POST',
				body: JSON.stringify( site ),
			} );
		},
		async disconnectWpcomSite( localSiteId, remoteSiteId ) {
			await api(
				`/sites/${ encodeURIComponent( localSiteId ) }/connected-sites/${ encodeURIComponent(
					remoteSiteId
				) }`,
				{ method: 'DELETE' }
			);
		},
		onSyncConnectSite( listener ) {
			syncConnectListeners.add( listener );
			return () => syncConnectListeners.delete( listener );
		},
		// Browser analog of the desktop's wp-studio:// deep link: after the user
		// opens the "Create new" checkout, ask the server to watch the account's
		// WordPress.com sites and report the new one back on the `sync-connect`
		// channel, which onSyncConnectSite above hands to the auto-connect hook.
		async watchForPublishedSite( siteId ) {
			await api( `/sites/${ encodeURIComponent( siteId ) }/watch-published-site`, {
				method: 'POST',
			} );
		},
		async pushSiteToLive( siteId, remoteSiteId, options, onPhase ) {
			const listener = ( output: PushSseOutput ) => {
				if ( output.siteId === siteId && output.kind === 'phase' ) {
					onPhase?.( output.phase, output.progress );
				}
			};
			if ( onPhase ) {
				pushOutputListeners.add( listener );
			}
			let result: { cancelled?: boolean } | undefined;
			try {
				result = await api( `/sites/${ encodeURIComponent( siteId ) }/push`, {
					method: 'POST',
					body: JSON.stringify( { remoteSiteId, options } ),
				} );
			} finally {
				pushOutputListeners.delete( listener );
			}
			// The server reports a cancel instead of failing the request; turn it
			// back into an error for the caller.
			if ( result?.cancelled ) {
				throw new SyncCancelledError();
			}
		},

		async cancelSync( siteId, remoteSiteId ) {
			await api( `/sites/${ encodeURIComponent( siteId ) }/sync/cancel`, {
				method: 'POST',
				body: JSON.stringify( { remoteSiteId } ),
			} );
		},
		async pullSiteFromLive( siteId, remoteSiteId, onProgress, options ) {
			const listener = ( output: PullProgressSseOutput ) => {
				if ( output.siteId === siteId ) {
					onProgress?.( {
						message: output.message,
						...( output.progress === undefined ? {} : { progress: output.progress } ),
						// Drives the cancel gate — without it every pull looks cancellable.
						...( output.action === undefined ? {} : { action: output.action } ),
					} );
				}
			};
			if ( onProgress ) {
				pullProgressListeners.add( listener );
			}
			let result: { cancelled?: boolean } | undefined;
			try {
				result = await api( `/sites/${ encodeURIComponent( siteId ) }/pull`, {
					method: 'POST',
					body: JSON.stringify( { remoteSiteId, options } ),
				} );
			} finally {
				pullProgressListeners.delete( listener );
			}
			if ( result?.cancelled ) {
				throw new SyncCancelledError();
			}
		},
		async getLatestRewindId( remoteSiteId ) {
			return api< string | null >( `/wpcom/sites/${ remoteSiteId }/latest-rewind-id` );
		},
		async listRemoteFileTree( remoteSiteId, rewindId, path ) {
			return api< Record< string, unknown > >(
				`/wpcom/sites/${ remoteSiteId }/remote-file-tree?rewindId=${ encodeURIComponent(
					rewindId
				) }&path=${ encodeURIComponent( path ) }`
			);
		},
		// Selective-sync local lookups: the server has no per-file endpoints yet,
		// so degrade the same way the dialog does elsewhere without this data —
		// category-level selection works; file trees, size estimates, and
		// version warnings are simply absent.
		async listLocalFileTree() {
			return [];
		},
		async getDirectorySize() {
			return 0;
		},
		async getFileSize() {
			return 0;
		},
		async getIsMultisite() {
			return undefined;
		},
		async getHostingPhpVersion( remoteSiteId ) {
			const version = await api< string | null >(
				`/wpcom/sites/${ remoteSiteId }/hosting-php-version`
			);
			return version ?? undefined;
		},
		getPublishCheckoutUrl( site ): string {
			// The post-checkout auto-connect relies on the deep-link listener, which
			// a browser tab can't receive, so the user finishes by connecting the
			// new site from the picker.
			return buildPublishCheckoutUrl( site );
		},

		// AI sessions — the headline. HTTP routes on the local server, backed by
		// the shared session store and the same CLI agent the desktop forks.
		async getSessions(): Promise< AiSessionSummary[] > {
			return api< AiSessionSummary[] >( '/sessions' );
		},
		async getSession( sessionId ): Promise< LoadedAiSession > {
			return api< LoadedAiSession >( `/sessions/${ encodeURIComponent( sessionId ) }` );
		},
		async deleteSession( sessionId ) {
			await api( `/sessions/${ encodeURIComponent( sessionId ) }`, { method: 'DELETE' } );
		},
		async updateSessionMetadata( sessionId, patch ): Promise< AiSessionSummary > {
			return api< AiSessionSummary >( `/sessions/${ encodeURIComponent( sessionId ) }`, {
				method: 'PATCH',
				body: JSON.stringify( patch ),
			} );
		},
		async createSession( siteId ): Promise< AiSessionSummary > {
			return api< AiSessionSummary >( '/sessions', {
				method: 'POST',
				body: JSON.stringify( { siteId } ),
			} );
		},
		async continueSession( sessionId, prompt, options ): Promise< { runId: string } > {
			return api< { runId: string } >( `/sessions/${ encodeURIComponent( sessionId ) }/messages`, {
				method: 'POST',
				body: JSON.stringify( { prompt, displayMessage: options?.displayMessage } ),
			} );
		},
		async getActiveAgentRuns(): Promise< ActiveAgentRun[] > {
			return api< ActiveAgentRun[] >( '/runs/active' );
		},
		async setSessionModel( sessionId, model ) {
			await api( `/sessions/${ encodeURIComponent( sessionId ) }/model`, {
				method: 'POST',
				body: JSON.stringify( { model } ),
			} );
		},
		async setSessionProvider( sessionId, provider, model ) {
			await api( `/sessions/${ encodeURIComponent( sessionId ) }/provider`, {
				method: 'POST',
				body: JSON.stringify( { provider, model } ),
			} );
		},
		async interruptAgentRun( runId ) {
			await api( `/runs/${ encodeURIComponent( runId ) }/interrupt`, { method: 'POST' } );
		},
		async answerAgentQuestion( runId, answers ) {
			await api( `/runs/${ encodeURIComponent( runId ) }/answer`, {
				method: 'POST',
				body: JSON.stringify( { answers } ),
			} );
		},
		async setSessionEnvironment( _sessionId, environment ) {
			// The agent always acts on the server's local runtime.
			return { environment };
		},
		onAgentEvent( listener ) {
			agentListeners.add( listener );
			return () => agentListeners.delete( listener );
		},
		onSessionPlacementUpdated( listener ) {
			placementListeners.add( listener );
			return () => placementListeners.delete( listener );
		},

		// Preferences come from the machine's own Studio config, the same files
		// the desktop reads, so both front ends show one set of values.
		async getUserPreferences(): Promise< UserPreferences > {
			const preferences = await api< ServerUserPreferences >( '/user-preferences' );
			return {
				...preferences,
				// This target is already running inside the CLI, not managing it.
				studioCliInstalled: false,
				studioCliExternallyManaged: false,
			};
		},
		async setUserPreferences( partial ) {
			// JSON drops `undefined` keys, so a clear has to travel as null.
			const patch = Object.fromEntries(
				Object.entries( partial ).map( ( [ key, value ] ) => [ key, value ?? null ] )
			);
			await api( '/user-preferences', { method: 'PATCH', body: JSON.stringify( patch ) } );
		},
		// Detected on the machine the server runs on (the desktop's installed-app
		// detection, server-side) so the preferences picker offers only what's there.
		async getInstalledApps(): Promise< InstalledApps > {
			return api< InstalledApps >( '/installed-apps' );
		},

		async getAppGlobals(): Promise< AppGlobals > {
			return { platform: 'browser', isWindowsStore: false };
		},

		async getAgentInstructions(): Promise< string > {
			const { content } = await api< { content: string } >( '/agent-instructions' );
			return content;
		},
		async saveAgentInstructions(
			content: string,
			options: { editSession?: { previousContent: string } } = {}
		): Promise< void > {
			await api< void >( '/agent-instructions', {
				method: 'POST',
				body: JSON.stringify( { content, editSession: options.editSession } ),
			} );
		},

		async getAiSettings(): Promise< AiSettings > {
			return api< AiSettings >( '/ai-settings' );
		},
		async saveAnthropicApiKey( key: string | null ): Promise< AiSettings > {
			return api< AiSettings >( '/ai-settings', {
				method: 'PUT',
				body: JSON.stringify( { anthropicApiKey: key } ),
			} );
		},
		async setAiProvider( provider: AiProviderId ): Promise< AiSettings > {
			return api< AiSettings >( '/ai-settings/provider', {
				method: 'PUT',
				body: JSON.stringify( { provider } ),
			} );
		},

		// The local server has no REST-proxy route yet; the preview omnibox
		// only offers search where the webview connector serves it.
		async fetchSiteRest() {
			throw new UnsupportedError( 'fetchSiteRest' );
		},

		// The server runs on the user's machine, so it opens paths in OS apps on
		// the browser's behalf (the editor/terminal choice comes from prefs above).
		async openSiteFolder( siteId ) {
			await api( `/sites/${ encodeURIComponent( siteId ) }/open-folder`, { method: 'POST' } );
		},
		// The server resolves the preference; a 400 means none is configured and
		// callers route the user to Settings, matching the desktop contract.
		async openSiteInEditor( siteId ) {
			await api( `/sites/${ encodeURIComponent( siteId ) }/open-in-editor`, { method: 'POST' } );
		},
		async openSiteInTerminal( siteId ) {
			await api( `/sites/${ encodeURIComponent( siteId ) }/open-in-terminal`, { method: 'POST' } );
		},

		// The CLI has no equivalent of the desktop's log file — site server output
		// goes to `~/.studio/daemon/logs` and the rest to the terminal that ran
		// `studio ui` — so there is nothing to open here.
		async openStudioLogs() {
			throw new UnsupportedError( 'openStudioLogs' );
		},

		// The server attaches the origin and common props. Callers fire and forget, so a
		// failure here must not become an unhandled rejection.
		async trackEvent( eventName, props = {} ) {
			await api< void >( '/analytics/event', {
				method: 'POST',
				body: JSON.stringify( { eventName, props } ),
			} ).catch( () => undefined );
		},

		// External links work natively in the browser.
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
		showsAppMenuButton: false,
		async openSiteUrl( siteId, relativeUrl = '' ) {
			const sites = lastSites ?? ( await api< SiteDetails[] >( '/sites' ) );
			const target = new URL( relativeUrl || '/', findSiteUrl( sites, siteId ) ).toString();
			window.open( target, '_blank', 'noopener,noreferrer' );
		},
		async getWordPressSkillsStatusAllSites() {
			return [];
		},
		async installWordPressSkillToAllSites() {
			// No-op: the local server does not manage WordPress skills yet.
		},
		async removeWordPressSkillFromAllSites() {
			// No-op: the local server does not manage WordPress skills yet.
		},

		// Window chrome — no traffic lights in a browser tab.
		reservesTrafficLightSpace: false,
		async ensureWindowWidth() {
			return window.innerWidth;
		},
		async isFullscreen() {
			return false;
		},
		onFullscreenChange() {
			return () => {};
		},
		onSiteEvent() {
			return () => {};
		},
		onToggleSitePreview() {
			// No application menu in a browser tab.
			return () => {};
		},
		async copyText( text ) {
			await navigator.clipboard.writeText( text );
		},
		async confirmDeleteAllPreviewSites() {
			return window.confirm(
				__(
					'All preview sites that exist for your WordPress.com account, along with all posts, pages, comments, and media, will be lost.'
				)
			);
		},
		onToggleSidebar() {
			// No application menu in a browser tab.
			return () => {};
		},
		onAddSite() {
			// No application menu in a browser tab.
			return () => {};
		},
		onAddSiteWithBlueprint() {
			return () => {};
		},
		onOpenSettings() {
			// No application menu in a browser tab.
			return () => {};
		},
		async disableAgenticUi() {
			// No-op in the browser.
		},
		async getOnboardingHints() {
			return readOnboardingHints();
		},
		async setOnboardingHints( partial ) {
			writeOnboardingHints( partial );
		},
		onShowGettingStarted() {
			// No application menu in a browser tab.
			return () => {};
		},
		onShowWhatsNew() {
			// No application menu in a browser tab.
			return () => {};
		},
		async getLastSeenVersion() {
			return readLastSeenVersion();
		},
		async saveLastSeenVersion( version ) {
			writeLastSeenVersion( version );
		},
		async getAppUpdateStatus() {
			return { readyToInstall: false, version: null };
		},
		async installAppUpdate() {
			// No-op.
		},
		onAppUpdateStatusChanged() {
			return () => {};
		},
	};
}
