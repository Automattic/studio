import type { SiteInfo } from './types';
import type { StudioChatArtifactData } from '@studio/agent/protocol/chat-artifacts';
import type { StudioChatImage } from '@studio/agent/protocol/chat-images';
import type { VisualAnnotation } from '@studio/agent/protocol/visual-annotations';
import type { SiteListItem } from '@studio/common/lib/cli-events';
import type { TracksEventName, TracksProps } from '@studio/common/lib/record-tracks-event';
import type { SiteStatus } from '@studio/common/types/site-status';
import type { Snapshot } from '@studio/common/types/snapshot';
import type { SyncSite } from '@studio/common/types/sync';
import type { PlatformPath } from 'node:path';

export type ProgressCallback = ( message: string, update?: boolean ) => void;

// A local site as the agent's tools see it.
export interface HostSite {
	id: string;
	name: string;
	path: string;
	url: string;
	phpVersion: string;
	adminPassword?: string;
}

// A note the user left on a page, with the images they attached to it.
export interface BrowserAnnotation extends VisualAnnotation {
	images: StudioChatImage[];
}

export interface WpCliOutput {
	exitCode: number;
	stdout: string;
	stderr: string;
}

// The path functions the tools use: Node's own on Node, so paths read the way
// the platform writes them, and POSIX ones in a browser.
export type HostPath = Pick<
	PlatformPath,
	'join' | 'resolve' | 'relative' | 'dirname' | 'basename' | 'extname' | 'isAbsolute' | 'sep'
> & {
	fileURLToPath( url: string ): string;
	pathToFileURL( path: string ): string;
};

// The files of the host's sites, by the paths the agent sees.
export interface HostFiles {
	read( path: string ): Promise< Uint8Array >;
	readText( path: string ): Promise< string >;
	// Creates the missing parent folders.
	write( path: string, data: Uint8Array | string ): Promise< void >;
	exists( path: string ): Promise< boolean >;
	isDirectory( path: string ): Promise< boolean >;
	mkdir( path: string ): Promise< void >;
	list( directory: string ): Promise< { name: string; directory: boolean }[] >;
	remove( path: string ): Promise< void >;
}

export interface PageOptions {
	viewport?: { width: number; height: number };
	deviceScaleFactor?: number;
	colorScheme?: 'light' | 'dark';
	// Emulates prefers-reduced-motion, so captures don't catch animations midway.
	reducedMotion?: boolean;
	// Runs in the page before its own scripts.
	initScript?: () => void;
	// 'networkidle' waits up to 30 seconds for the network to go quiet; by default
	// the page is ready once its DOM is, plus up to 2.5 seconds of quiet.
	waitUntil?: 'networkidle';
}

// A page loaded in the host's browser. Scripts run in the page, so they must be
// self-contained and take JSON-serializable arguments.
export interface HostPage {
	evaluate< R >( script: () => R | Promise< R > ): Promise< R >;
	evaluate< A, R >( script: ( arg: A ) => R | Promise< R >, arg: A ): Promise< R >;
	waitFor( condition: () => boolean, timeoutMs: number ): Promise< void >;
	// Hovers the first element `selector` matches, or moves the pointer off the page.
	hover( selector: string | null ): Promise< void >;
	screenshot( options: {
		format: 'png' | 'jpeg';
		quality?: number;
		fullPage?: boolean;
		clip?: { x: number; y: number; width: number; height: number };
	} ): Promise< Uint8Array >;
	url(): string;
	// The HTTP status of the page's own response; 0 for a rendered document.
	status(): number;
	isClosed(): boolean;
	close(): Promise< void >;
}

export interface HostPages {
	// Resolves once the page has loaded. `signIn` opens a site page as the site's
	// administrator; `html` renders a document of its own.
	open(
		target: { url: string; signIn?: boolean } | { html: string },
		options?: PageOptions
	): Promise< HostPage >;
	// Fetches a text resource, such as a site's robots.txt, without a page.
	fetchText( url: string ): Promise< { status: number; body: string } >;
}

// What an app that shows the conversation does for the agent.
export interface StudioAgentUi {
	// Shows a tool's result in the conversation, such as a site preview or an image.
	showArtifact( artifact: StudioChatArtifactData ): Promise< void > | void;
	// Reloads the site preview the app shows.
	reloadPreview(): void;
}

// What the app running the agent provides: the site operations its tools run,
// which the CLI implements with its own commands, and how the agent reaches the
// user. Operations return their result and throw when they fail; progress goes
// to `onProgress`.
export interface StudioAgentHost {
	// The folder Studio's sites live in. The file tools are rooted here.
	sitesRoot: string;
	// The User-Agent requests to WordPress.com carry, naming the app and its version.
	userAgent: string;
	sites: {
		resolve( nameOrPath: string ): Promise< HostSite >;
		findByFolder( folder: string ): Promise< HostSite | undefined >;
		all(): Promise< HostSite[] >;
		list(): Promise< Omit< SiteListItem, 'adminPassword' >[] >;
		status( site: HostSite ): Promise< SiteStatus >;
		create( name: string, sitePath: string, onProgress: ProgressCallback ): Promise< void >;
		start( site: HostSite, onProgress: ProgressCallback ): Promise< void >;
		stop( site: HostSite, onProgress: ProgressCallback ): Promise< void >;
		delete( site: HostSite, deleteFiles: boolean, onProgress: ProgressCallback ): Promise< void >;
		isRunning( site: HostSite ): Promise< boolean >;
		import( site: HostSite, file: string, onProgress: ProgressCallback ): Promise< void >;
		export(
			site: HostSite,
			file: string,
			mode: 'full' | 'db',
			onProgress: ProgressCallback
		): Promise< void >;
		wpCli( site: HostSite, args: string[] ): Promise< WpCliOutput >;
	};
	previews: {
		list( site: HostSite ): Promise< Snapshot[] >;
		create( site: HostSite, onProgress: ProgressCallback ): Promise< Snapshot >;
		update(
			site: HostSite,
			hostname: string,
			overwrite: boolean,
			onProgress: ProgressCallback
		): Promise< Snapshot >;
		delete( hostname: string, onProgress: ProgressCallback ): Promise< void >;
	};
	// Push and pull return the WordPress.com site they synced with, or nothing when
	// the user backed out.
	sync: {
		push(
			site: HostSite,
			options: string,
			remoteSite: string | undefined,
			onProgress: ProgressCallback
		): Promise< SyncSite | undefined >;
		pull(
			site: HostSite,
			options: string,
			remoteSite: string | undefined,
			onProgress: ProgressCallback
		): Promise< SyncSite | undefined >;
	};
	wpcom: {
		// The signed-in user's access token, or nothing when signed out.
		token(): Promise< string | undefined >;
		// The token image generation uses, or nothing when it is unavailable.
		imageToken(): Promise< string | undefined >;
		sites( accessToken: string ): Promise< unknown[] >;
		// The WordPress.com sites a local site syncs with; empty when signed out.
		connectedSites( site: HostSite ): Promise< SyncSite[] >;
		// A REST request as the signed-in user; throws when signed out. An empty
		// `apiNamespace` in `query` means the WordPress.com REST API v1.1.
		request(
			method: 'GET' | 'POST' | 'PUT' | 'DELETE',
			path: string,
			query: Record< string, unknown >,
			body?: Record< string, unknown >
		): Promise< unknown >;
		// The folder `wpcom_request` reads request bodies from.
		payloadsDirectory: string;
	};
	tracks: {
		record( event: TracksEventName, props: TracksProps ): Promise< void >;
	};
	path: HostPath;
	files: HostFiles;
	pages: HostPages;
	// Saves an image the agent made, such as a screenshot, where the user can open it.
	saveImage(
		bytes: Uint8Array,
		name: string,
		mimeType: string
	): Promise< { path: string; url: string } >;
	// Opens a site in a browser the user annotates; resolves with their notes.
	// Present where the host can open a browser window of its own.
	annotate?( url: string, timeoutMs: number ): Promise< BrowserAnnotation[] | null >;
	// Makes a site the agent created the conversation's site.
	selectSite?( site: SiteInfo ): Promise< void > | void;
	// Present when an app shows the conversation. Tools that only make sense
	// there, and their mentions in the prompt, depend on it.
	ui?: StudioAgentUi;
}
