import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { fetchStudioBlueprints } from '@studio/common/lib/studio-blueprints-api';
import { fetchWordPressVersions } from '@studio/common/lib/wordpress-versions';
import type {
	ActiveAgentRun,
	AiSessionPlacementUpdatedEvent,
	AiSessionSummary,
	AuthUser,
	AvailableSitePath,
	Connector,
	FeaturedBlueprint,
	InstalledApps,
	LoadedAiSession,
	SiteDetails,
	SkillStatus,
	Snapshot,
	SnapshotUsage,
	SyncSite,
	UserPreferences,
} from '../../types';
import type { AgentRunEvent } from '@studio/common/ai/agent-events';

export interface HostedConnectorOptions {
	// Base URL of the Studio hosted backend (`apps/hosted`), e.g. http://localhost:8088.
	apiBaseUrl: string;
}

/**
 * Thrown by connector methods that have no meaning in a browser (native file
 * dialogs, opening an editor/terminal, etc.). Callers in the UI already wrap
 * these affordances in try/catch, so throwing keeps the surface honest without
 * breaking the app.
 */
export class WebUnsupportedError extends Error {
	constructor( operation: string ) {
		super( `"${ operation }" is not available in Studio Web.` );
		this.name = 'WebUnsupportedError';
	}
}

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

// Envelope used by the backend's `/events` SSE stream so a single connection
// can carry both agent-run events and session-placement updates.
type ServerEvent =
	| { channel: 'agent'; payload: AgentRunEvent }
	| { channel: 'placement'; payload: AiSessionPlacementUpdatedEvent };

/**
 * The Studio Web data source: the web analog of the Electron IPC connector.
 * Same React app, same `AgentRunEvent` stream, different transport — it speaks
 * HTTP + SSE instead of IPC.
 *
 * Its peer is whatever implements that HTTP/SSE contract: the Studio Web
 * backend in `apps/hosted`, run locally today and hosted later. This connector
 * doesn't care which — that's the point of the boundary, and why the UI needs no
 * changes to move from local to hosted.
 *
 * This is the first Studio Web increment, extracted from the broader
 * exploration in https://github.com/Automattic/studio/pull/3746. Only the
 * surface it exercises is implemented for real (AI sessions and runs, the site
 * list, featured blueprints, external links). Desktop-only capabilities either
 * return benign defaults (so mount-time queries don't throw) or throw
 * `WebUnsupportedError` for user-triggered actions.
 */
export function createHostedConnector( { apiBaseUrl }: HostedConnectorOptions ): Connector {
	// The backend namespaces its API under /api so the SPA's real-path routes
	// (also /sessions/:id, /sites/:id) can share the same origin.
	const base = `${ apiBaseUrl.replace( /\/$/, '' ) }/api`;

	const agentListeners = new Set< ( event: AgentRunEvent ) => void >();
	const placementListeners = new Set< ( event: AiSessionPlacementUpdatedEvent ) => void >();
	const notificationClickListeners = new Set< ( event: { sessionId: string } ) => void >();
	let eventSource: EventSource | undefined;
	// Last site list fetched via getSites(), so one-off lookups (openSiteUrl)
	// don't trigger an extra round-trip to the WordPress.com API.
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

	function findSiteUrl( sites: SiteDetails[], siteId: string ): string {
		const site = sites.find( ( candidate ) => candidate.id === siteId );
		if ( ! site?.url ) {
			throw new Error( `Site ${ siteId } has no URL` );
		}
		return site.url;
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
				}
			};
		},

		// Auth — runs unauthenticated, like the desktop app. WordPress.com login
		// in the browser is a follow-up (explored in the PR linked above).
		requiresAuth: false,
		// Hosted mode has no real auth, so agentic features can't be gated on
		// sign-in state — they stay always-on.
		supportsAgenticOptOut: false,
		async isAuthenticated() {
			return true;
		},
		async getAuthUser(): Promise< AuthUser | null > {
			return null;
		},
		async authenticate() {
			// No-op: there is no login gate yet.
		},
		async logout() {
			// No-op.
		},
		onAuthStateChanged() {
			return () => {};
		},

		// Onboarding — hosted mode has no first-run welcome; report it as
		// already completed so routing never lands there.
		async getOnboardingCompleted() {
			return true;
		},
		async setOnboardingCompleted() {
			// No-op.
		},

		// Sites
		async getSites(): Promise< SiteDetails[] > {
			lastSites = await api< SiteDetails[] >( '/sites' );
			return lastSites;
		},
		async createSite() {
			throw new WebUnsupportedError( 'createSite' );
		},
		async deleteSite() {
			throw new WebUnsupportedError( 'deleteSite' );
		},
		async copySite(): Promise< SiteDetails > {
			throw new WebUnsupportedError( 'copySite' );
		},
		async startSite() {
			throw new WebUnsupportedError( 'startSite' );
		},
		async stopSite() {
			throw new WebUnsupportedError( 'stopSite' );
		},
		async updateSite() {
			throw new WebUnsupportedError( 'updateSite' );
		},
		async refreshSiteIcon() {
			// No-op: icons come back with getSites().
		},
		async getSiteOverviewDetails() {
			throw new WebUnsupportedError( 'getSiteOverviewDetails' );
		},
		async scaffoldPlugin() {
			throw new WebUnsupportedError( 'scaffoldPlugin' );
		},
		async getSiteThumbnail(): Promise< string | null > {
			return null;
		},
		async getXdebugEnabledSite(): Promise< SiteDetails | null > {
			return null;
		},
		async exportFullSite(): Promise< string | null > {
			throw new WebUnsupportedError( 'exportFullSite' );
		},
		async exportDatabase(): Promise< string | null > {
			throw new WebUnsupportedError( 'exportDatabase' );
		},
		async generateProposedSiteName(): Promise< string > {
			throw new WebUnsupportedError( 'generateProposedSiteName' );
		},
		async generateProposedSitePath() {
			throw new WebUnsupportedError( 'generateProposedSitePath' );
		},
		async findAvailableSitePath(): Promise< AvailableSitePath > {
			throw new WebUnsupportedError( 'findAvailableSitePath' );
		},
		async selectSiteFolder() {
			throw new WebUnsupportedError( 'selectSiteFolder' );
		},
		async comparePaths() {
			throw new WebUnsupportedError( 'comparePaths' );
		},

		// Featured blueprints — public endpoint, same source as the desktop app.
		async getFeaturedBlueprints( locale ): Promise< FeaturedBlueprint[] > {
			const blueprints = await fetchStudioBlueprints( locale );
			return blueprints.map( ( blueprint ) => ( {
				slug: blueprint.slug,
				title: blueprint.title,
				excerpt: blueprint.excerpt,
				image: blueprint.image,
				playgroundUrl: blueprint.playground_url,
				blueprint: blueprint.blueprint as FeaturedBlueprint[ 'blueprint' ],
			} ) );
		},
		async getWordPressVersions() {
			return fetchWordPressVersions();
		},

		async getFilePath() {
			// Browsers can't resolve a real filesystem path for a File.
			return '';
		},
		async createTemporaryTextFile() {
			throw new WebUnsupportedError( 'createTemporaryTextFile' );
		},
		async readLocalMediaFile() {
			throw new WebUnsupportedError( 'readLocalMediaFile' );
		},
		async captureSiteScreenshot() {
			throw new WebUnsupportedError( 'captureSiteScreenshot' );
		},
		async extractBlueprintBundle() {
			throw new WebUnsupportedError( 'extractBlueprintBundle' );
		},
		async cleanupBlueprintTempDir() {
			// No-op.
		},
		async readBlueprintFile(): Promise< Record< string, unknown > > {
			throw new WebUnsupportedError( 'readBlueprintFile' );
		},
		onAddSiteRequested() {
			return () => {};
		},
		onAddSiteWithBlueprint() {
			return () => {};
		},
		async importSiteFromBackup(): Promise< SiteDetails > {
			throw new WebUnsupportedError( 'importSiteFromBackup' );
		},

		// Preview snapshots / sync — out of scope for this increment.
		async getSnapshots(): Promise< Snapshot[] > {
			return [];
		},
		async getSnapshotUsage(): Promise< SnapshotUsage | null > {
			return {
				siteCount: 0,
				siteLimit: 10,
				siteCreationBlocked: false,
			};
		},
		async deleteAllSnapshots() {
			// No-op: hosted mode does not create WordPress.com preview sites.
		},
		async publishPreviewSite(): Promise< { url: string } > {
			throw new WebUnsupportedError( 'publishPreviewSite' );
		},
		async getConnectedWpcomSites(): Promise< SyncSite[] > {
			return [];
		},
		async fetchSyncableWpcomSites(): Promise< SyncSite[] > {
			return [];
		},
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
		async connectWpcomSite() {
			throw new WebUnsupportedError( 'connectWpcomSite' );
		},
		async disconnectWpcomSite() {
			throw new WebUnsupportedError( 'disconnectWpcomSite' );
		},
		onSyncConnectSite() {
			return () => {};
		},
		async pushSiteToLive() {
			throw new WebUnsupportedError( 'pushSiteToLive' );
		},
		async pullSiteFromLive() {
			throw new WebUnsupportedError( 'pullSiteFromLive' );
		},
		async getLiveSyncItems() {
			throw new WebUnsupportedError( 'getLiveSyncItems' );
		},
		async getLiveSyncImportStatus() {
			throw new WebUnsupportedError( 'getLiveSyncImportStatus' );
		},
		async getLiveSyncLatestBackupTime() {
			throw new WebUnsupportedError( 'getLiveSyncLatestBackupTime' );
		},
		async markLiveSiteSynced() {
			throw new WebUnsupportedError( 'markLiveSiteSynced' );
		},
		getPublishCheckoutUrl() {
			return undefined;
		},

		// AI sessions — the headline. HTTP routes on the web-server, backed by
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
		async answerAgentPermission( runId, requestId, decision ) {
			await api( `/runs/${ encodeURIComponent( runId ) }/permission`, {
				method: 'POST',
				body: JSON.stringify( { requestId, decision } ),
			} );
		},
		async setSessionEnvironment( _sessionId, environment ) {
			// The agent always acts on the backend's local runtime.
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
			const notification = new Notification( title, { body, tag: sessionId } );
			notification.onclick = () => {
				window.focus();
				notificationClickListeners.forEach( ( listener ) => listener( { sessionId } ) );
			};
		},
		onChatNotificationClicked( listener ) {
			notificationClickListeners.add( listener );
			return () => notificationClickListeners.delete( listener );
		},

		// User preferences — sensible browser defaults.
		async getUserPreferences(): Promise< UserPreferences > {
			return {
				editor: null,
				terminal: null,
				colorScheme: 'system',
				locale: undefined,
				defaultSiteDirectory: '',
				studioCliInstalled: false,
				agenticFeaturesEnabled: true,
				chatNotificationsEnabled: true,
				agentResponseLength: 'normal',
				defaultAiModel: DEFAULT_MODEL,
				toolPermissions: {},
			};
		},
		async setUserPreferences() {
			// No-op: preferences aren't persisted in the browser yet.
		},
		async previewColorScheme() {
			// No-op: the hosted UI follows the browser theme.
		},
		async selectDefaultSiteDirectory() {
			return null;
		},
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
		async getInstalledApps(): Promise< InstalledApps > {
			return {} as InstalledApps;
		},

		async fetchSiteRest() {
			throw new WebUnsupportedError( 'fetchSiteRest' );
		},

		// Filesystem / native integrations — not available in a browser.
		async openSiteFolder() {
			throw new WebUnsupportedError( 'openSiteFolder' );
		},
		async openSiteInEditor() {
			throw new WebUnsupportedError( 'openSiteInEditor' );
		},
		async openSiteInTerminal() {
			throw new WebUnsupportedError( 'openSiteInTerminal' );
		},

		// External links work natively in the browser.
		async openExternalUrl( url ) {
			window.open( url, '_blank', 'noopener,noreferrer' );
		},
		async copyText( text ) {
			await navigator.clipboard.writeText( text );
		},
		async copyImage( pngDataUrl ) {
			const blob = await ( await fetch( pngDataUrl ) ).blob();
			await navigator.clipboard.write( [ new ClipboardItem( { 'image/png': blob } ) ] );
		},
		async openSiteUrl( siteId, relativeUrl = '' ) {
			const sites = lastSites ?? ( await api< SiteDetails[] >( '/sites' ) );
			const target = new URL( relativeUrl || '/', findSiteUrl( sites, siteId ) ).toString();
			window.open( target, '_blank', 'noopener,noreferrer' );
		},
		async confirmDeleteAllPreviewSites() {
			return window.confirm(
				'All preview sites that exist for your WordPress.com account, along with all posts, pages, comments, and media, will be lost.'
			);
		},
		async getWordPressSkillsStatusAllSites(): Promise< SkillStatus[] > {
			return [];
		},
		async installWordPressSkillToAllSites() {
			// No-op: hosted mode does not install local WordPress skills.
		},
		async removeWordPressSkillFromAllSites() {
			// No-op: hosted mode does not install local WordPress skills.
		},

		// Window chrome — no traffic lights in a browser tab.
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
		onToggleSidebar() {
			// No application menu in a browser tab.
			return () => {};
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

		// Browser tabs have no auto-updater; report an inert status (rather
		// than throwing) because the messaging layer polls unconditionally.
		async getAppUpdateStatus() {
			return { readyToInstall: false, version: null };
		},

		onAppUpdateStatusChanged() {
			return () => {};
		},

		async installAppUpdate() {},
	};
}
