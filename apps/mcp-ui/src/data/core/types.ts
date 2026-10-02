export interface LocalSite {
	id: string;
	name: string;
	path: string;
	url?: string;
	running?: boolean;
	phpVersion?: string;
}

export interface WpcomSite {
	id: number | string;
	name: string;
	url: string;
	planName?: string;
	isStaging?: boolean;
	syncSupport?: string;
	lastPullTimestamp?: string | null;
	lastPushTimestamp?: string | null;
	createdAt?: string;
}

export interface Library {
	localSites: LocalSite[];
	wpcom: { signedIn: boolean; sites: WpcomSite[]; error: string };
}

export type SiteKind = 'local' | 'wpcom';

export type SiteEntry =
	| { kind: 'local'; key: string; site: LocalSite }
	| { kind: 'wpcom'; key: string; site: WpcomSite };

export type DisplayMode = 'inline' | 'fullscreen' | 'pip';

export interface HostContext {
	theme?: 'light' | 'dark';
	displayMode?: DisplayMode;
	availableDisplayModes?: DisplayMode[];
	safeAreaInsets?: Partial< Record< 'top' | 'right' | 'bottom' | 'left', number > >;
	styles?: { variables?: Record< string, string > };
	'openai/deepLink'?: { url?: string };
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
	structuredContent?: Record< string, unknown >;
	isError?: boolean;
}

export interface LiveTool {
	name: string;
	description: string;
	inputSchema: Record< string, unknown >;
	annotations?: Record< string, unknown >;
	call: ( args: Record< string, unknown > ) => ToolResult;
}

export interface UserMessage {
	text: string;
	openaiTarget?: { target: 'new' } | { target: 'active'; send: true };
}

export interface Connector {
	initialize(): Promise< void >;
	getHostState(): HostState;
	subscribeHostState( listener: () => void ): () => void;
	onLibraryResult( listener: ( read: () => Library ) => void ): () => void;
	setLiveTools( tools: LiveTool[] ): void;
	readLibrary(): Promise< Library >;
	readSitePreview( siteId: string ): Promise< string | null >;
	setSiteRunning( sitePath: string, running: boolean ): Promise< void >;
	readLoginUrl(): Promise< string >;
	logIn( token: string ): Promise< void >;
	sendMessage( message: UserMessage ): Promise< void >;
	updateModelContext( text: string, title: string ): Promise< void >;
	openLink( url: string ): Promise< void >;
	requestDisplayMode( mode: DisplayMode ): Promise< void >;
	notifySize( height: number ): void;
}
