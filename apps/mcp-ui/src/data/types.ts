export interface LocalSite {
	id: string;
	name: string;
	path: string;
	url?: string;
	running?: boolean;
	phpVersion?: string;
}

export interface WpcomSite {
	id: number;
	name: string;
	url: string;
	planName?: string;
	isStaging?: boolean;
	lastPullTimestamp?: string | null;
	lastPushTimestamp?: string | null;
}

export interface WpcomAccount {
	signedIn: boolean;
	sites: WpcomSite[];
	error: string;
}

export type SiteEntry = { kind: 'local'; site: LocalSite } | { kind: 'wpcom'; site: WpcomSite };

export type DisplayMode = 'inline' | 'fullscreen' | 'pip';

export interface HostContext {
	theme?: 'light' | 'dark';
	displayMode?: DisplayMode;
	safeAreaInsets?: Partial< Record< 'top' | 'right' | 'bottom' | 'left', number > >;
	[ key: string ]: unknown;
}

export type HostCapabilities = Record< string, unknown >;

export interface HostState {
	status: 'starting' | 'ready' | 'failed';
	capabilities: HostCapabilities;
	context: HostContext;
}

export interface ToolResult {
	content?: { type: string; text?: string }[];
	_meta?: Record< string, unknown >;
	isError?: boolean;
}

export interface UserMessage {
	text: string;
	openaiTarget?: { target: 'new'; send: false };
}
