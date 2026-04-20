import type { AiSessionSummary, LoadedAiSession } from '@studio/common/ai/sessions/types';
import type { Snapshot } from '@studio/common/types/snapshot';
import type { SyncSite } from '@studio/common/types/sync';

export type {
	AiSessionSummary,
	LoadedAiSession,
	AiSessionEvent,
} from '@studio/common/ai/sessions/types';
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
	createSite( params: { name: string } ): Promise< SiteDetails >;
	deleteSite( id: string ): Promise< void >;
	startSite( id: string ): Promise< void >;
	stopSite( id: string ): Promise< void >;

	// Preview snapshots (WordPress.com hosted previews of local sites)
	getSnapshots(): Promise< Snapshot[] >;

	// Connected WordPress.com live sites for a given local site
	getConnectedWpcomSites( localSiteId: string ): Promise< SyncSite[] >;

	// AI sessions (shared with the CLI — stored as JSONL on disk)
	getSessions(): Promise< AiSessionSummary[] >;
	getSession( sessionId: string ): Promise< LoadedAiSession >;
	deleteSession( sessionId: string ): Promise< void >;

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
