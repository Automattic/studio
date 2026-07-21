import { DEFAULT_MODEL } from '@studio/common/ai/models';
import {
	DEFAULT_ACTIVITY_SOUND_PREFERENCES,
	resolveActivitySoundPreferences,
} from '@studio/common/lib/activity-sounds';
import { getAuthenticationUrl } from '@studio/common/lib/oauth';
import { fetchWordPressVersions } from '@studio/common/lib/wordpress-versions';
import { __ } from '@wordpress/i18n';
import { applyStoredSiteOrder, storeSiteOrder } from '../browser-site-order';
import { UnsupportedError } from '../unsupported-error';
import type {
	ActiveAgentRun,
	AiSessionPlacementUpdatedEvent,
	AiSessionSummary,
	AuthUser,
	AvailableSitePath,
	ColorScheme,
	Connector,
	ExtractedBlueprintBundle,
	InstalledApps,
	LoadedAiSession,
	LocalMediaFile,
	OnboardingHintsState,
	ProposedSitePath,
	QuitSitesBehavior,
	SelectedSiteFolder,
	SiteCheckpoint,
	SiteDetails,
	SkillStatus,
	Snapshot,
	SnapshotUsage,
	SupportedEditor,
	SupportedTerminal,
	SyncSite,
	UserPreferences,
} from '../../types';
import type { AgentRunEvent } from '@studio/common/ai/agent-events';
import type { SiteRestResponse } from '@studio/common/types/wordpress-rest';

// The in-app dark/light/system choice, persisted in the browser (there's no
// Electron `nativeTheme` to mirror it) so it sticks across reloads.
const COLOR_SCHEME_STORAGE_KEY = 'studio-local-color-scheme';
// Editor/terminal choices live in the browser too (no Electron user-settings
// store); the server reads them back from each open request.
const EDITOR_STORAGE_KEY = 'studio-local-editor';
const TERMINAL_STORAGE_KEY = 'studio-local-terminal';
const QUIT_SITES_BEHAVIOR_STORAGE_KEY = 'studio-local-quit-sites-behavior';
const ACTIVITY_SOUND_PREFERENCES_STORAGE_KEY = 'studio-activity-sound-preferences';

function readActivitySoundPreferences() {
	try {
		return resolveActivitySoundPreferences(
			JSON.parse( window.localStorage.getItem( ACTIVITY_SOUND_PREFERENCES_STORAGE_KEY ) ?? 'null' )
		);
	} catch {
		return DEFAULT_ACTIVITY_SOUND_PREFERENCES;
	}
}

function parseQuitSitesBehavior( value: string | null ): QuitSitesBehavior | undefined {
	return value === 'leave-running' || value === 'stop-and-auto-start' || value === 'stop'
		? value
		: undefined;
}

// Persistent-message dismissals live in the browser too (per origin).
const DISMISSED_MESSAGES_STORAGE_KEY = 'studio-dismissed-messages';

function readDismissedMessages(): string[] {
	try {
		const raw = window.localStorage.getItem( DISMISSED_MESSAGES_STORAGE_KEY );
		const parsed: unknown = raw ? JSON.parse( raw ) : [];
		return Array.isArray( parsed )
			? parsed.filter( ( id ): id is string => typeof id === 'string' )
			: [];
	} catch {
		return [];
	}
}

// Workbench onboarding state persists per origin in the browser surface.
const ONBOARDING_HINTS_STORAGE_KEY = 'studio-onboarding-hints';

function readOnboardingHints(): OnboardingHintsState {
	try {
		const raw = window.localStorage.getItem( ONBOARDING_HINTS_STORAGE_KEY );
		const parsed: unknown = raw ? JSON.parse( raw ) : {};
		return parsed && typeof parsed === 'object' ? ( parsed as OnboardingHintsState ) : {};
	} catch {
		return {};
	}
}

function writeOnboardingHints( partial: Partial< OnboardingHintsState > ): void {
	const current = readOnboardingHints();
	const merged: OnboardingHintsState = {
		...current,
		...partial,
		completedItems: { ...( current.completedItems ?? {} ), ...( partial.completedItems ?? {} ) },
	};
	window.localStorage.setItem( ONBOARDING_HINTS_STORAGE_KEY, JSON.stringify( merged ) );
}

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

// Envelope used by the backend's `/events` SSE stream so a single connection
// can carry agent-run events, session-placement updates, and snapshot progress.
type ServerEvent =
	| { channel: 'agent'; payload: AgentRunEvent }
	| { channel: 'placement'; payload: AiSessionPlacementUpdatedEvent }
	| { channel: 'snapshot'; payload: SnapshotSseOutput }
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
	const syncConnectListeners = new Set<
		( event: { remoteSiteId: number; studioSiteId: string } ) => void
	>();
	const notificationClickListeners = new Set< ( event: { sessionId: string } ) => void >();
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
			throw new Error(
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
			// One SSE connection carries both agent and placement events; the
			// browser's EventSource reconnects automatically.
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
			siteCheckpoints: true,
			readLocalMedia: false,
		},

		// Auth — surfaces the WordPress.com user the CLI is already logged in as
		// (read from the shared auth token by the server). The app isn't gated on
		// it, but the user menu should show the real account.
		requiresAuth: false,
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
		async authenticate() {
			// Open the popup synchronously (inside the click gesture) so it isn't
			// blocked, then navigate it once the authorize URL is resolved.
			const popup = window.open( 'about:blank', 'studio-auth', 'width=600,height=720' );

			let loginUrl: string | null = null;
			try {
				( { url: loginUrl } = await api< { url: string | null } >(
					`/auth/login-url?redirect_uri=${ encodeURIComponent(
						`${ window.location.origin }/auth/callback`
					) }`
				) );
			} catch {
				loginUrl = null;
			}

			if ( ! loginUrl ) {
				// No OAuth client configured → paste-the-token fallback.
				popup?.close();
				window.open(
					getAuthenticationUrl( 'en', 'https://developer.wordpress.com/copy-oauth-token' ),
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
			lastSites = applyStoredSiteOrder( await api< SiteDetails[] >( '/sites' ) );
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

		// Site creation — delegated to the CLI `create` on the local machine.
		async createSite( params ): Promise< SiteDetails > {
			return api< SiteDetails >( '/sites', {
				method: 'POST',
				body: JSON.stringify( {
					name: params.name,
					path: params.path,
					phpVersion: params.phpVersion,
					runtime: params.runtime,
					fileAccess: params.fileAccess,
					wpVersion: params.wpVersion,
					customDomain: params.customDomain,
					enableHttps: params.enableHttps,
					adminUsername: params.adminUsername,
					adminPassword: params.adminPassword,
					adminEmail: params.adminEmail,
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
			storeSiteOrder( updates );
		},
		// Export downloads the archive in the browser (no native Save-As dialog).
		async exportFullSite( siteId ): Promise< string | null > {
			return downloadFromServer( `/sites/${ encodeURIComponent( siteId ) }/export?mode=full` );
		},
		async exportDatabase( siteId ): Promise< string | null > {
			return downloadFromServer( `/sites/${ encodeURIComponent( siteId ) }/export?mode=database` );
		},

		getWordPressVersions: fetchWordPressVersions,

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
		async importSiteFromBackup( siteId, backup ): Promise< SiteDetails > {
			return api< SiteDetails >( `/sites/${ encodeURIComponent( siteId ) }/import`, {
				method: 'POST',
				body: JSON.stringify( { path: backup.path, type: backup.type } ),
			} );
		},

		// Site checkpoints — the server forks the same `studio checkpoint`
		// commands the terminal user runs.
		async listCheckpoints( siteId ): Promise< SiteCheckpoint[] > {
			return api< SiteCheckpoint[] >( `/sites/${ encodeURIComponent( siteId ) }/checkpoints` );
		},
		async createCheckpoint( siteId, label ) {
			await api( `/sites/${ encodeURIComponent( siteId ) }/checkpoints`, {
				method: 'POST',
				body: JSON.stringify( { label } ),
			} );
		},
		async restoreCheckpoint( siteId, checkpointId ) {
			await api(
				`/sites/${ encodeURIComponent( siteId ) }/checkpoints/${ encodeURIComponent(
					checkpointId
				) }/restore`,
				{ method: 'POST' }
			);
		},
		async deleteCheckpoint( siteId, checkpointId ) {
			await api(
				`/sites/${ encodeURIComponent( siteId ) }/checkpoints/${ encodeURIComponent(
					checkpointId
				) }`,
				{ method: 'DELETE' }
			);
		},

		// Preview snapshots + WordPress.com sync — backed by the server's snapshot
		// manager and sync routes (the same shared code the desktop uses).
		async getSnapshots(): Promise< Snapshot[] > {
			return api< Snapshot[] >( '/snapshots' );
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
			return api< SyncSite[] >( `/sites/${ encodeURIComponent( localSiteId ) }/connected-sites` );
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
		async pushSiteToLive( siteId, remoteSiteId ) {
			await api( `/sites/${ encodeURIComponent( siteId ) }/push`, {
				method: 'POST',
				body: JSON.stringify( { remoteSiteId } ),
			} );
		},
		async pullSiteFromLive( siteId, remoteSiteId ) {
			await api( `/sites/${ encodeURIComponent( siteId ) }/pull`, {
				method: 'POST',
				body: JSON.stringify( { remoteSiteId } ),
			} );
		},
		getPublishCheckoutUrl( site ): string {
			// The same WordPress.com hosted-site checkout the desktop opens — a pure
			// URL builder, so it ports verbatim. (The post-checkout auto-connect still
			// relies on the deep-link listener, which a browser tab can't receive, so
			// the user finishes by connecting the new site from the picker.)
			const url = new URL( 'https://wordpress.com/setup/new-hosted-site' );
			url.searchParams.set( 'ref', 'studio' );
			url.searchParams.set( 'section', 'publish-site' );
			url.searchParams.set( 'showDomainStep', 'true' );
			url.searchParams.set( 'studioSiteId', site.id );
			url.searchParams.set( 'new', site.customDomain ?? site.name );
			url.searchParams.set( 'autoOpenPush', 'true' );
			return url.toString();
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

		// User preferences are persisted in the browser; `locale` follows the app.
		async getUserPreferences(): Promise< UserPreferences > {
			const stored = window.localStorage.getItem( COLOR_SCHEME_STORAGE_KEY );
			const colorScheme: ColorScheme =
				stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
			const quitSitesBehavior = parseQuitSitesBehavior(
				window.localStorage.getItem( QUIT_SITES_BEHAVIOR_STORAGE_KEY )
			);
			return {
				editor:
					( window.localStorage.getItem( EDITOR_STORAGE_KEY ) as SupportedEditor | null ) || null,
				terminal:
					( window.localStorage.getItem( TERMINAL_STORAGE_KEY ) as SupportedTerminal | null ) ||
					null,
				colorScheme,
				locale: undefined,
				// The rest are desktop-managed preferences with sensible defaults
				// here; the settings screens hide their controls in the browser
				// (`showNativePreferences`).
				defaultSiteDirectory: '',
				// `studio ui` is served by the CLI itself.
				studioCliInstalled: true,
				agenticFeaturesEnabled: true,
				chatNotificationsEnabled: true,
				activitySoundPreferences: readActivitySoundPreferences(),
				quitSitesBehavior: quitSitesBehavior ?? 'ask',
				agentResponseLength: 'normal',
				defaultAiModel: DEFAULT_MODEL,
				toolPermissions: {},
			};
		},
		async setUserPreferences( partial ) {
			if ( partial.activitySoundPreferences ) {
				window.localStorage.setItem(
					ACTIVITY_SOUND_PREFERENCES_STORAGE_KEY,
					JSON.stringify( partial.activitySoundPreferences )
				);
			}
			if ( partial.colorScheme ) {
				window.localStorage.setItem( COLOR_SCHEME_STORAGE_KEY, partial.colorScheme );
			}
			if ( partial.editor !== undefined ) {
				if ( partial.editor ) {
					window.localStorage.setItem( EDITOR_STORAGE_KEY, partial.editor );
				} else {
					window.localStorage.removeItem( EDITOR_STORAGE_KEY );
				}
			}
			if ( partial.terminal !== undefined ) {
				if ( partial.terminal ) {
					window.localStorage.setItem( TERMINAL_STORAGE_KEY, partial.terminal );
				} else {
					window.localStorage.removeItem( TERMINAL_STORAGE_KEY );
				}
			}
			if ( 'quitSitesBehavior' in partial ) {
				if ( partial.quitSitesBehavior ) {
					window.localStorage.setItem( QUIT_SITES_BEHAVIOR_STORAGE_KEY, partial.quitSitesBehavior );
				} else {
					window.localStorage.removeItem( QUIT_SITES_BEHAVIOR_STORAGE_KEY );
				}
			}
		},
		// Detected on the machine the server runs on (the desktop's installed-app
		// detection, server-side) so the preferences picker offers only what's there.
		async getInstalledApps(): Promise< InstalledApps > {
			return api< InstalledApps >( '/installed-apps' );
		},

		// Proxy WordPress REST calls through the server to the running site (it
		// holds the auto-login cookie + nonce); the shared proxy backs both hosts.
		async fetchSiteRest( siteId, request ): Promise< SiteRestResponse > {
			return api< SiteRestResponse >( `/sites/${ encodeURIComponent( siteId ) }/rest`, {
				method: 'POST',
				body: JSON.stringify( request ),
			} );
		},

		// The server runs on the user's machine, so it opens paths in OS apps on
		// the browser's behalf (the editor/terminal choice comes from prefs above).
		async openSiteFolder( siteId ) {
			await api( `/sites/${ encodeURIComponent( siteId ) }/open-folder`, { method: 'POST' } );
		},
		async openSiteInEditor( siteId ) {
			const editor = window.localStorage.getItem( EDITOR_STORAGE_KEY );
			if ( ! editor ) {
				// Matches the desktop contract: callers route the user to Settings.
				throw new Error( 'No preferred editor configured.' );
			}
			await api( `/sites/${ encodeURIComponent( siteId ) }/open-in-editor`, {
				method: 'POST',
				body: JSON.stringify( { editor } ),
			} );
		},
		async openSiteInTerminal( siteId ) {
			const terminal = window.localStorage.getItem( TERMINAL_STORAGE_KEY ) ?? undefined;
			await api( `/sites/${ encodeURIComponent( siteId ) }/open-in-terminal`, {
				method: 'POST',
				body: JSON.stringify( { terminal } ),
			} );
		},

		// External links work natively in the browser.
		async openExternalUrl( url ) {
			window.open( url, '_blank', 'noopener,noreferrer' );
		},
		async popupAppMenu() {},
		showsAppMenuButton: false,
		async openSiteUrl( siteId, relativeUrl = '' ) {
			const sites = lastSites ?? ( await api< SiteDetails[] >( '/sites' ) );
			const target = new URL( relativeUrl || '/', findSiteUrl( sites, siteId ) ).toString();
			window.open( target, '_blank', 'noopener,noreferrer' );
		},

		// Window chrome — no traffic lights in a browser tab.
		reservesTrafficLightSpace: false,
		async isFullscreen() {
			return false;
		},
		onFullscreenChange() {
			return () => {};
		},
		async expandWindowForWorkbench() {
			// A browser tab can't resize itself.
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
		async copyImage( pngDataUrl ) {
			const blob = await ( await fetch( pngDataUrl ) ).blob();
			await navigator.clipboard.write( [ new ClipboardItem( { 'image/png': blob } ) ] );
		},
		onToggleSidebar() {
			// No application menu in a browser tab.
			return () => {};
		},

		// Agentic gating — like hosted mode, the browser surface has no per-user
		// opt-out; agentic features stay always-on.
		supportsAgenticOptOut: false,

		// Gated-tool permissions ride the same run routes as answers; the shared
		// run manager forwards the decision to the CLI child.
		async answerAgentPermission( runId, requestId, decision ) {
			await api( `/runs/${ encodeURIComponent( runId ) }/permission`, {
				method: 'POST',
				body: JSON.stringify( { requestId, decision } ),
			} );
		},

		// Web Notifications stand in for the desktop's OS notifications. The
		// caller has already decided the user isn't looking at this session.
		async showChatNotification( { sessionId, title, body } ) {
			if ( ! ( 'Notification' in window ) ) {
				return;
			}
			if ( Notification.permission === 'default' ) {
				await Notification.requestPermission();
			}
			if ( Notification.permission !== 'granted' ) {
				return;
			}
			// `tag` collapses successive notifications for the same session.
			const notification = new Notification( title, { body, tag: sessionId, silent: true } );
			notification.onclick = () => {
				window.focus();
				notificationClickListeners.forEach( ( listener ) => listener( { sessionId } ) );
			};
		},
		onChatNotificationClicked( listener ) {
			notificationClickListeners.add( listener );
			return () => notificationClickListeners.delete( listener );
		},

		// Persistent-message dismissals live in localStorage on the web.
		async getDismissedMessages() {
			return readDismissedMessages();
		},
		async dismissMessage( id ) {
			const dismissed = readDismissedMessages();
			if ( ! dismissed.includes( id ) ) {
				window.localStorage.setItem(
					DISMISSED_MESSAGES_STORAGE_KEY,
					JSON.stringify( [ ...dismissed, id ] )
				);
			}
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
		onOpenSettings() {
			// No application menu in a browser tab.
			return () => {};
		},
		async disableAgenticUi() {
			// No-op in the browser.
		},

		// Sites — desktop-only affordances not yet exposed by the local server.
		async getSiteOverviewDetails() {
			throw new UnsupportedError( 'getSiteOverviewDetails' );
		},
		async scaffoldPlugin() {
			throw new UnsupportedError( 'scaffoldPlugin' );
		},
		async getSiteThumbnail(): Promise< string | null > {
			return null;
		},
		async getXdebugEnabledSite(): Promise< SiteDetails | null > {
			return null;
		},

		async isCertificateTrusted(): Promise< boolean > {
			return false;
		},

		async trustCertificate() {
			throw new UnsupportedError( 'trustCertificate' );
		},

		async openSiteFileInEditor() {
			throw new UnsupportedError( 'openSiteFileInEditor' );
		},

		async openSiteDebugLog( siteId ) {
			await api( `/sites/${ encodeURIComponent( siteId ) }/open-debug-log`, {
				method: 'POST',
			} );
		},

		async getAgentInstructionsStatus() {
			throw new UnsupportedError( 'getAgentInstructionsStatus' );
		},

		async installAgentInstructions() {
			throw new UnsupportedError( 'installAgentInstructions' );
		},

		async removeAgentInstruction() {
			throw new UnsupportedError( 'removeAgentInstruction' );
		},

		async getWordPressSkillsStatus() {
			throw new UnsupportedError( 'getWordPressSkillsStatus' );
		},

		async installWordPressSkillById() {
			throw new UnsupportedError( 'installWordPressSkillById' );
		},

		async removeWordPressSkillById() {
			throw new UnsupportedError( 'removeWordPressSkillById' );
		},

		async findAvailableSitePath(): Promise< AvailableSitePath > {
			throw new UnsupportedError( 'findAvailableSitePath' );
		},
		async createTemporaryTextFile() {
			throw new UnsupportedError( 'createTemporaryTextFile' );
		},
		async captureSiteScreenshot() {
			throw new UnsupportedError( 'captureSiteScreenshot' );
		},
		async captureFullPageScreenshot() {
			throw new UnsupportedError( 'captureFullPageScreenshot' );
		},
		onAddSite() {
			return () => {};
		},
		onAddSiteWithBlueprint() {
			return () => {};
		},

		// Preview snapshots — listed for real above; account-level usage and bulk
		// deletion aren't exposed by the local server yet.
		async getSnapshotUsage(): Promise< SnapshotUsage | null > {
			return null;
		},
		async deleteAllSnapshots() {
			throw new UnsupportedError( 'deleteAllSnapshots' );
		},
		async confirmDeleteAllPreviewSites() {
			return window.confirm(
				__(
					'All preview sites that exist for your WordPress.com account, along with all posts, pages, comments, and media, will be lost.'
				)
			);
		},

		// WordPress.com sync — push/pull are real above; the itemized live-sync
		// UI endpoints aren't exposed by the local server yet.
		async fetchSyncableWpcomSitesPage() {
			return {
				sites: [],
				total: 0,
				page: 1,
				perPage: 100,
				hasMore: false,
				nextPage: null,
			};
		},
		async getLiveSyncItems() {
			throw new UnsupportedError( 'getLiveSyncItems' );
		},
		async getLiveSyncImportStatus() {
			throw new UnsupportedError( 'getLiveSyncImportStatus' );
		},
		async getLiveSyncLatestBackupTime() {
			return null;
		},
		async markLiveSiteSynced() {
			// No-op: called after a successful push/pull; the local server tracks
			// connected-site state on its own side.
		},

		// WordPress skills — managed from the desktop app for now.
		async getWordPressSkillsStatusAllSites(): Promise< SkillStatus[] > {
			return [];
		},
		async installWordPressSkillToAllSites() {
			// No-op: local web mode does not manage WordPress skills yet.
		},
		async removeWordPressSkillFromAllSites() {
			// No-op: local web mode does not manage WordPress skills yet.
		},

		// App shell — browser tabs have no auto-updater or native settings events.
		async getAppGlobals() {
			return {
				platform: 'browser',
				appName: 'WordPress Studio',
				appVersion: '',
				arm64Translation: false,
				isWindowsStore: false,
				enableAgenticUi: true,
			};
		},
		onUserSettings() {
			return () => {};
		},
		async previewColorScheme() {
			// No-op: the local UI applies the scheme itself via user preferences.
		},
		// Report an inert update status (rather than throwing) because the
		// messaging layer polls unconditionally.
		async getAppUpdateStatus() {
			return { readyToInstall: false, version: null };
		},
		onAppUpdateStatusChanged() {
			return () => {};
		},
		async installAppUpdate() {},
	};
}
