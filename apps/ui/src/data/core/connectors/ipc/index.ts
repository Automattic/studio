import type { AgentRunEvent } from '../../agent-events';
import type {
	AiSessionSummary,
	AuthUser,
	ColorScheme,
	Connector,
	LoadedAiSession,
	ProposedSitePath,
	SelectedSiteFolder,
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
			} ) ) as SiteDetails;
		},

		async deleteSite( id ) {
			await ipcApi.deleteSite( id, false );
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
