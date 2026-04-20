import type { AgentRunEvent } from './agent-events';
import type { AiModelId } from '@studio/common/ai/models';
import type { AiSessionSummary, LoadedAiSession } from '@studio/common/ai/sessions/types';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { Snapshot } from '@studio/common/types/snapshot';
import type { SyncSite } from '@studio/common/types/sync';

export type {
	AiSessionSummary,
	LoadedAiSession,
	AiSessionEvent,
} from '@studio/common/ai/sessions/types';
export type { AiModelId } from '@studio/common/ai/models';
export type { Snapshot } from '@studio/common/types/snapshot';
export type { SyncSite } from '@studio/common/types/sync';

export interface SiteDetails {
	id: string;
	name: string;
	path: string;
	port: number;
	running: boolean;
	url?: string;
	customDomain?: string;
	enableHttps?: boolean;
	phpVersion: string;
	isWpAutoUpdating?: boolean;
	adminUsername?: string;
	// Base64-encoded. Use encodePassword/decodePassword from
	// @studio/common/lib/passwords when reading or writing.
	adminPassword?: string;
	adminEmail?: string;
	enableXdebug?: boolean;
	enableDebugLog?: boolean;
	enableDebugDisplay?: boolean;
	themeDetails?: {
		name: string;
		path: string;
		slug: string;
		isBlockTheme: boolean;
	};
}

export interface AuthUser {
	id: number;
	email: string;
	displayName: string;
}

export interface Connector {
	/**
	 * Optional hook for connector-specific setup that must run after the
	 * connector is constructed but before the UI renders.
	 */
	init?(): Promise< void >;

	// Auth
	requiresAuth: boolean;
	isAuthenticated(): Promise< boolean >;
	getAuthUser(): Promise< AuthUser | null >;
	authenticate(): Promise< void >;
	logout(): Promise< void >;

	// Sites
	getSites(): Promise< SiteDetails[] >;
	createSite( params: CreateSiteParams ): Promise< SiteDetails >;
	deleteSite( id: string ): Promise< void >;
	startSite( id: string ): Promise< void >;
	stopSite( id: string ): Promise< void >;
	// Persists edits from the site-settings screen via the CLI-backed main
	// process handler. `wpVersion` is only forwarded when the user explicitly
	// picked a pinned version — undefined means "keep auto-updating".
	updateSite( site: SiteDetails, wpVersion?: string ): Promise< void >;
	// Xdebug is exclusive across sites; returns the one site currently using
	// it (or null) so the settings form can block a conflicting toggle.
	getXdebugEnabledSite(): Promise< SiteDetails | null >;

	// Site-creation helpers — surface the same main-process capabilities the
	// desktop app's add-site flow relies on (folder pickers, path validation,
	// and domain lookups).
	generateProposedSitePath( siteName: string ): Promise< ProposedSitePath >;
	generateProposedSiteName( usedSites: SiteDetails[] ): Promise< string >;
	selectSiteFolder( defaultPath: string ): Promise< SelectedSiteFolder | null >;
	comparePaths( path1: string, path2: string ): Promise< boolean >;
	getAllCustomDomains(): Promise< string[] >;

	// Preview snapshots (WordPress.com hosted previews of local sites)
	getSnapshots(): Promise< Snapshot[] >;

	// Connected WordPress.com live sites for a given local site
	getConnectedWpcomSites( localSiteId: string ): Promise< SyncSite[] >;

	// AI sessions (shared with the CLI — stored as JSONL on disk)
	getSessions(): Promise< AiSessionSummary[] >;
	getSession( sessionId: string ): Promise< LoadedAiSession >;
	deleteSession( sessionId: string ): Promise< void >;

	// Create an empty session file attached to a site, so the new session
	// appears in the sidebar immediately. The first prompt flows through
	// `continueSession` as usual.
	createSession( siteId: string ): Promise< AiSessionSummary >;

	// Continue an existing session by sending a new prompt. Returns a `runId`
	// that identifies the in-flight agent run; live events for that run stream
	// through `onAgentEvent`.
	continueSession( sessionId: string, prompt: string ): Promise< { runId: string } >;
	// Persist a UI-driven model override for the session. The CLI picks this up
	// on the next turn; the change survives reloads because it's written to the
	// session JSONL.
	setSessionModel( sessionId: string, model: AiModelId ): Promise< void >;
	interruptAgentRun( runId: string ): Promise< void >;
	answerAgentQuestion( runId: string, answers: Record< string, string > ): Promise< void >;
	onAgentEvent( listener: ( event: AgentRunEvent ) => void ): () => void;

	// Flip the session between acting on its owner site's local runtime vs.
	// its linked WordPress.com live site. The owner site itself never changes.
	setSessionEnvironment(
		sessionId: string,
		environment: 'local' | 'live'
	): Promise< { environment: 'local' | 'live'; url?: string; wpcomSiteId?: number } >;

	// Locale
	getUserLocale(): Promise< string | undefined >;

	// Color scheme
	getColorScheme(): Promise< ColorScheme >;
	saveColorScheme( scheme: ColorScheme ): Promise< void >;

	// External links
	openExternalUrl( url: string ): Promise< void >;

	// Window state (macOS fullscreen hides traffic lights, so the UI needs
	// to reclaim the space we normally leave for them).
	isFullscreen(): Promise< boolean >;
	onFullscreenChange( listener: ( fullscreen: boolean ) => void ): () => void;

	// Fires whenever a site is created, updated, started, stopped, or deleted.
	// Consumers typically invalidate cached site data in response.
	onSiteEvent( listener: () => void ): () => void;
}

export type ColorScheme = 'system' | 'light' | 'dark';

export interface CreateSiteParams {
	name: string;
	path: string;
	phpVersion?: SupportedPHPVersion;
	wpVersion?: string;
	customDomain?: string;
	enableHttps?: boolean;
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
}

export interface ProposedSitePath {
	path: string;
	isEmpty: boolean;
	isWordPress: boolean;
	isNameTooLong?: boolean;
}

export interface SelectedSiteFolder {
	path: string;
	name: string;
	isEmpty: boolean;
	isWordPress: boolean;
}
