import { createDefaultDeskSettings } from '@studio/common/lib/desk-settings';
import type {
	ActiveAgentRun,
	AiSessionPlacementUpdatedEvent,
	AiSessionSummary,
	AuthUser,
	Connector,
	DeskConfig,
	DeskSettings,
	FeaturedBlueprint,
	InstalledApps,
	LoadedAiSession,
	SiteDetails,
	SitePreviewFile,
	Snapshot,
	SyncSite,
	UserPreferences,
} from '../../types';
import type { AgentRunEvent } from '@studio/common/ai/agent-events';

export interface WebConnectorOptions {
	// Base URL of the `studio web-server` backend, e.g. http://localhost:8088.
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

// Envelope used by the backend's `/events` SSE stream so a single connection
// can carry both agent-run events and session-placement updates.
type ServerEvent =
	| { channel: 'agent'; payload: AgentRunEvent }
	| { channel: 'placement'; payload: AiSessionPlacementUpdatedEvent }
	| { channel: 'preview'; payload: { sessionId: string } };

/**
 * Connector that talks to the headless `studio web-server` over HTTP + SSE.
 * It is the web analog of the Electron IPC connector: the same React app, the
 * same `AgentRunEvent` stream, a different transport.
 *
 * Only the surface the PoC exercises is implemented for real (AI sessions and
 * runs, the site list, featured blueprints, external links). Desktop-only
 * capabilities either return benign defaults (so mount-time queries don't
 * throw) or throw `WebUnsupportedError` for user-triggered actions.
 */
export function createWebConnector( { apiBaseUrl }: WebConnectorOptions ): Connector {
	const base = apiBaseUrl.replace( /\/$/, '' );

	const agentListeners = new Set< ( event: AgentRunEvent ) => void >();
	const placementListeners = new Set< ( event: AiSessionPlacementUpdatedEvent ) => void >();
	const previewListeners = new Set< ( sessionId: string ) => void >();
	let eventSource: EventSource | undefined;

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
				} else if ( parsed.channel === 'preview' ) {
					previewListeners.forEach( ( listener ) => listener( parsed.payload.sessionId ) );
				}
			};
		},

		// Auth — the PoC runs unauthenticated, like the desktop app.
		requiresAuth: false,
		async isAuthenticated() {
			return true;
		},
		async getAuthUser(): Promise< AuthUser | null > {
			return null;
		},
		async authenticate() {
			// No-op: the PoC has no login gate.
		},
		async logout() {
			// No-op.
		},
		onAuthStateChanged() {
			return () => {};
		},

		// Sites
		async getSites(): Promise< SiteDetails[] > {
			return api< SiteDetails[] >( '/sites' );
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
		async selectSiteFolder() {
			throw new WebUnsupportedError( 'selectSiteFolder' );
		},
		async comparePaths() {
			throw new WebUnsupportedError( 'comparePaths' );
		},
		async getAllCustomDomains(): Promise< string[] > {
			return [];
		},

		// Featured blueprints — public endpoint, identical to the IPC connector.
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

		async getFilePath() {
			// Browsers can't resolve a real filesystem path for a File.
			return '';
		},
		async readLocalMediaFile() {
			throw new WebUnsupportedError( 'readLocalMediaFile' );
		},
		async extractBlueprintBundle() {
			throw new WebUnsupportedError( 'extractBlueprintBundle' );
		},
		async cleanupBlueprintTempDir() {
			// No-op.
		},
		async importSiteFromBackup(): Promise< SiteDetails > {
			throw new WebUnsupportedError( 'importSiteFromBackup' );
		},

		// Preview snapshots / sync — out of PoC scope.
		async getSnapshots(): Promise< Snapshot[] > {
			return [];
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
			// The PoC's agent always acts on the backend's local runtime.
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

		// The session workspace's deployable files, for the client-side Playground
		// preview. The web-server reads them from the session's git workspace.
		async getSiteFiles( sessionId ): Promise< SitePreviewFile[] > {
			return api< SitePreviewFile[] >(
				`/sessions/${ encodeURIComponent( sessionId ) }/site-files`
			);
		},
		onPreviewChanged( listener ) {
			previewListeners.add( listener );
			return () => previewListeners.delete( listener );
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
			// No-op for the PoC.
		},
		async getInstalledApps(): Promise< InstalledApps > {
			return {} as InstalledApps;
		},

		// Desks — defaults so both UI modes mount cleanly.
		async getDeskSettings(): Promise< DeskSettings > {
			return createDefaultDeskSettings();
		},
		async saveDeskSettings() {
			// No-op for the PoC.
		},
		async exportDeskConfig(): Promise< string | null > {
			return null;
		},
		async importDeskConfig(): Promise< DeskConfig | null > {
			return null;
		},
		async getUserDeskConfig(): Promise< DeskConfig | undefined > {
			return undefined;
		},
		async saveUserDeskConfig() {
			// No-op for the PoC.
		},
		async getSiteDeskConfig(): Promise< DeskConfig | undefined > {
			return undefined;
		},
		async saveSiteDeskConfig() {
			// No-op for the PoC.
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
		async openSiteUrl( siteId, relativeUrl = '' ) {
			const sites = await api< SiteDetails[] >( '/sites' );
			const target = new URL( relativeUrl || '/', findSiteUrl( sites, siteId ) ).toString();
			window.open( target, '_blank', 'noopener,noreferrer' );
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
	};
}
