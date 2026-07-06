import { fetchStudioBlueprints } from '@studio/common/lib/studio-blueprints-api';
import { UnsupportedError } from '../unsupported-error';
import type {
	ActiveAgentRun,
	AiSessionPlacementUpdatedEvent,
	AiSessionSummary,
	AuthUser,
	Connector,
	FeaturedBlueprint,
	InstalledApps,
	LoadedAiSession,
	SiteDetails,
	Snapshot,
	SyncSite,
	UserPreferences,
} from '../../types';
import type { AgentRunEvent } from '@studio/common/ai/agent-events';

export interface HostedConnectorOptions {
	// Base URL of the Studio hosted backend (`apps/hosted`), e.g. http://localhost:8088.
	apiBaseUrl: string;
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
 * `UnsupportedError` for user-triggered actions.
 */
export function createHostedConnector( { apiBaseUrl }: HostedConnectorOptions ): Connector {
	// The backend namespaces its API under /api so the SPA's real-path routes
	// (also /sessions/:id, /sites/:id) can share the same origin.
	const base = `${ apiBaseUrl.replace( /\/$/, '' ) }/api`;

	const agentListeners = new Set< ( event: AgentRunEvent ) => void >();
	const placementListeners = new Set< ( event: AiSessionPlacementUpdatedEvent ) => void >();
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

		// Remote browser host: no native dialogs, no access to the user's machine,
		// and a cross-origin iframe preview that can't host the annotation inspector.
		capabilities: {
			nativeFolderPicker: false,
			nativeSaveDialog: false,
			openInOS: false,
			annotatePreview: false,
		},

		// Auth — runs unauthenticated, like the desktop app. WordPress.com login
		// in the browser is a follow-up (explored in the PR linked above).
		requiresAuth: false,
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

		// Sites
		async getSites(): Promise< SiteDetails[] > {
			lastSites = await api< SiteDetails[] >( '/sites' );
			return lastSites;
		},
		async createSite() {
			throw new UnsupportedError( 'createSite' );
		},
		async deleteSite() {
			throw new UnsupportedError( 'deleteSite' );
		},
		async copySite(): Promise< SiteDetails > {
			throw new UnsupportedError( 'copySite' );
		},
		async startSite() {
			throw new UnsupportedError( 'startSite' );
		},
		async stopSite() {
			throw new UnsupportedError( 'stopSite' );
		},
		async updateSite() {
			throw new UnsupportedError( 'updateSite' );
		},
		async refreshSiteIcon() {
			// No-op: icons come back with getSites().
		},
		async exportFullSite(): Promise< string | null > {
			throw new UnsupportedError( 'exportFullSite' );
		},
		async exportDatabase(): Promise< string | null > {
			throw new UnsupportedError( 'exportDatabase' );
		},
		async generateProposedSiteName(): Promise< string > {
			throw new UnsupportedError( 'generateProposedSiteName' );
		},
		async generateProposedSitePath() {
			throw new UnsupportedError( 'generateProposedSitePath' );
		},
		async selectSiteFolder() {
			throw new UnsupportedError( 'selectSiteFolder' );
		},
		async comparePaths() {
			throw new UnsupportedError( 'comparePaths' );
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

		async getFilePath() {
			// Browsers can't resolve a real filesystem path for a File.
			return '';
		},
		async readLocalMediaFile() {
			throw new UnsupportedError( 'readLocalMediaFile' );
		},
		async extractBlueprintBundle() {
			throw new UnsupportedError( 'extractBlueprintBundle' );
		},
		async cleanupBlueprintTempDir() {
			// No-op.
		},
		async importSiteFromBackup(): Promise< SiteDetails > {
			throw new UnsupportedError( 'importSiteFromBackup' );
		},

		// Preview snapshots / sync — out of scope for this increment.
		async getSnapshots(): Promise< Snapshot[] > {
			return [];
		},
		async publishPreviewSite(): Promise< { url: string } > {
			throw new UnsupportedError( 'publishPreviewSite' );
		},
		async getConnectedWpcomSites(): Promise< SyncSite[] > {
			return [];
		},
		async fetchSyncableWpcomSites(): Promise< SyncSite[] > {
			return [];
		},
		async connectWpcomSite() {
			throw new UnsupportedError( 'connectWpcomSite' );
		},
		async disconnectWpcomSite() {
			throw new UnsupportedError( 'disconnectWpcomSite' );
		},
		onSyncConnectSite() {
			return () => {};
		},
		async pushSiteToLive() {
			throw new UnsupportedError( 'pushSiteToLive' );
		},
		async pullSiteFromLive() {
			throw new UnsupportedError( 'pullSiteFromLive' );
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

		// User preferences — sensible browser defaults.
		async getUserPreferences(): Promise< UserPreferences > {
			return {
				editor: null,
				terminal: null,
				colorScheme: 'system',
				locale: undefined,
			};
		},
		async setUserPreferences() {
			// No-op: preferences aren't persisted in the browser yet.
		},
		async getInstalledApps(): Promise< InstalledApps > {
			return {} as InstalledApps;
		},

		async fetchSiteRest() {
			throw new UnsupportedError( 'fetchSiteRest' );
		},

		// Filesystem / native integrations — not available in a browser.
		async openSiteFolder() {
			throw new UnsupportedError( 'openSiteFolder' );
		},
		async openSiteInEditor() {
			throw new UnsupportedError( 'openSiteInEditor' );
		},
		async openSiteInTerminal() {
			throw new UnsupportedError( 'openSiteInTerminal' );
		},

		// External links work natively in the browser.
		async openExternalUrl( url ) {
			window.open( url, '_blank', 'noopener,noreferrer' );
		},
		async copyText( text ) {
			await navigator.clipboard.writeText( text );
		},
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
		onAddSite() {
			// No application menu in a browser tab.
			return () => {};
		},
		onOpenSettings() {
			// No application menu in a browser tab.
			return () => {};
		},
	};
}
