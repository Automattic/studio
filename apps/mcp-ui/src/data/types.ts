export interface LocalSite {
	id: string;
	name: string;
	path: string;
	url?: string;
	running?: boolean;
	phpVersion?: string;
}

export type DisplayMode = 'inline' | 'fullscreen' | 'pip';

export interface HostContext {
	theme?: 'light' | 'dark';
	displayMode?: DisplayMode;
	availableDisplayModes?: DisplayMode[];
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
	openaiTarget?: { target: 'new' } | { target: 'active'; send: true };
}
