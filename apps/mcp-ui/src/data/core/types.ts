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
	styles?: { variables?: Record< string, string > };
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

export interface Connector {
	initialize(): Promise< void >;
	getHostState(): HostState;
	subscribeHostState( listener: () => void ): () => void;
	onLocalSitesResult( listener: ( read: () => LocalSite[] ) => void ): () => void;
	readLocalSites(): Promise< LocalSite[] >;
	waitForSiteChanges( since?: number ): Promise< number >;
	readSitePreview( siteId: string ): Promise< string | null >;
	setSiteRunning( sitePath: string, running: boolean ): Promise< void >;
	sendMessage( message: UserMessage ): Promise< void >;
	updateModelContext( text: string, title: string ): Promise< void >;
	openLink( url: string ): Promise< void >;
	requestDisplayMode( mode: DisplayMode ): Promise< void >;
	notifySize( height: number ): void;
}
