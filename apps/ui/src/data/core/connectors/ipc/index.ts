import type { AgentRunEvent } from '../../agent-events';
import type {
	AiSessionSummary,
	AuthUser,
	ColorScheme,
	Connector,
	LoadedAiSession,
	SiteDetails,
	Snapshot,
	SyncSite,
} from '../../types';

/**
 * Creates a connector that delegates to the Electron IPC bridge.
 * Expects `window.ipcApi` to be exposed by the preload script.
 */
export function createIpcConnector(): Connector {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const ipcApi = ( window as any ).ipcApi;

	if ( ! ipcApi ) {
		throw new Error(
			'IPC API not available. Are you running inside Electron with the preload script?'
		);
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
			return ( await ipcApi.createSite( params.name ) ) as SiteDetails;
		},

		async deleteSite( id ) {
			await ipcApi.deleteSite( id, false );
		},

		async startSite( id ) {
			await ipcApi.startServer( id );
		},

		async stopSite( id ) {
			await ipcApi.stopServer( id );
		},

		// Preview snapshots
		async getSnapshots(): Promise< Snapshot[] > {
			return ( await ipcApi.fetchSnapshots() ) as Snapshot[];
		},

		// Connected WPCom sites
		async getConnectedWpcomSites( localSiteId: string ): Promise< SyncSite[] > {
			return ( await ipcApi.getConnectedWpcomSites( localSiteId ) ) as SyncSite[];
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

		async continueSession( sessionId, prompt ): Promise< { runId: string } > {
			return ( await ipcApi.continueAiSession( sessionId, prompt ) ) as { runId: string };
		},

		async interruptAgentRun( runId ) {
			await ipcApi.interruptAiAgentRun( runId );
		},

		onAgentEvent( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe( 'ai-agent-event', ( _event: unknown, payload: AgentRunEvent ) =>
				listener( payload )
			);
		},

		// Locale
		async getUserLocale(): Promise< string | undefined > {
			return ipcApi.getUserLocale();
		},

		// Color scheme
		async getColorScheme(): Promise< ColorScheme > {
			return ipcApi.getColorScheme();
		},

		async saveColorScheme( scheme: ColorScheme ): Promise< void > {
			await ipcApi.saveColorScheme( scheme );
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
