import type { RemoteHost } from './remote-hosts';
import type { SiteInfo } from './types';
import type { StudioChatArtifactData } from '@studio/agent/protocol/chat-artifacts';
import type { StudioChatImage } from '@studio/agent/protocol/chat-images';
import type { VisualAnnotation } from '@studio/agent/protocol/visual-annotations';
import type { ImageGenerator } from '@studio/agent/shared/image-generation';
import type { SiteListItem } from '@studio/common/lib/cli-events';
import type { StudioFeedback } from '@studio/common/lib/feedback';
import type { TracksEventName, TracksProps } from '@studio/common/lib/record-tracks-event';
import type { SiteStatus } from '@studio/common/types/site-status';
import type { Snapshot } from '@studio/common/types/snapshot';

export type ProgressCallback = ( message: string, update?: boolean ) => void;

// A local site as the agent's tools see it.
export interface HostSite {
	id: string;
	name: string;
	path: string;
	url: string;
	phpVersion: string;
	adminPassword?: string;
	// WordPress logs PHP errors to wp-content/debug.log (WP_DEBUG_LOG).
	enableDebugLog?: boolean;
}

/** A process to spawn: its binary, arguments, directory and environment. */
export interface WpCliProcess {
	command: string;
	args: string[];
	cwd: string;
	env: Record< string, string | undefined >;
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
export interface HostPath {
	join( ...paths: string[] ): string;
	resolve( ...paths: string[] ): string;
	relative( from: string, to: string ): string;
	dirname( path: string ): string;
	basename( path: string, suffix?: string ): string;
	extname( path: string ): string;
	isAbsolute( path: string ): boolean;
	sep: string;
	fileURLToPath( url: string ): string;
}

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
	// Every file under `directory`, by its `/`-separated path relative to it.
	walk( directory: string ): Promise< string[] >;
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
	// The size the page lays out at, and a change of it, as a wider screen gives.
	viewportSize(): { width: number; height: number } | null;
	setViewportSize( size: { width: number; height: number } ): Promise< void >;
	url(): string;
	// The HTTP status of the page's own response; 0 for a rendered document.
	status(): number;
	// The page's HTML as its server sent it; undefined for a rendered document.
	html(): Promise< string | undefined >;
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

// The site operations the tools run. Site operations belong to the app: the
// CLI runs its own commands, so each operation has one implementation.
export interface HostSites {
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
	/**
	 * The process `studio wp` runs for the arguments after `wp`, given in
	 * folder `cwd` with environment `env`, for the agent's shell to run
	 * itself; it rejects with why it does not run.
	 */
	wpCliProcess?(
		cwd: string,
		argv: string[],
		env: Record< string, string | undefined >
	): Promise< WpCliProcess >;
}

// Preview sites: temporary WordPress.com copies of a local site.
export interface HostPreviews {
	list( site: HostSite ): Promise< Snapshot[] >;
	create( site: HostSite, onProgress: ProgressCallback ): Promise< Snapshot >;
	update(
		site: HostSite,
		hostname: string,
		overwrite: boolean,
		onProgress: ProgressCallback
	): Promise< Snapshot >;
	delete( hostname: string, onProgress: ProgressCallback ): Promise< void >;
}

export interface HostTracks {
	record( event: TracksEventName, props: TracksProps ): Promise< void >;
}

// What an app that shows the conversation does for the agent.
export interface StudioAgentUi {
	// Shows a tool's result in the conversation, such as a site preview or an image.
	showArtifact( artifact: StudioChatArtifactData ): Promise< void > | void;
	// Reloads the site preview the app shows.
	reloadPreview(): void;
}

// What the app running the agent provides. The agent never imports an app:
// everything it needs from one comes through here, so the same tools run in
// Node and in a browser. Operations return their result and throw when they
// fail; progress goes to `onProgress`.
export interface StudioAgentHost {
	// The folder Studio's sites live in. The file tools are rooted here.
	sitesRoot: string;

	sites: HostSites;
	previews: HostPreviews;
	// The hosts besides this computer that the user's sites are on, by id.
	remoteHosts: Record< string, RemoteHost >;
	tracks: HostTracks;
	path: HostPath;
	files: HostFiles;
	pages: HostPages;
	// Saves an image the agent made, such as a screenshot, where the user can open it.
	saveImage(
		bytes: Uint8Array,
		name: string,
		mimeType: string
	): Promise< { path: string; url: string } >;

	// Optional: each one a host provides turns on the tools, and the prompt text,
	// that need it.

	// A Studio UI shows the conversation: tool results show in it as chat
	// artifacts.
	ui?: StudioAgentUi;
	// A browser window the user annotates a site in, resolving with their notes:
	// open_annotation_browser.
	annotate?(
		url: string,
		timeoutMs: number,
		signal?: AbortSignal
	): Promise< BrowserAnnotation[] | null >;
	// The conversation follows a site the agent creates.
	selectSite?( site: SiteInfo ): Promise< void > | void;
	// Image generation through a connected provider that offers it, or nothing
	// when none does: generate_images and the imagery prompt sections.
	imageGenerator?(): Promise< ImageGenerator | undefined >;
	// Blocks Engine's PHP transformer, which convert_to_blocks runs in a site's
	// WordPress: the file that loads it, and its version. Installed on first use.
	blocksEngine?(): Promise< { bootstrap: string; version: string } >;
	// Sends a feedback report to the WordPress Studio team as the signed-in user,
	// returning the ID the service assigned it: send_feedback and the feedback skill.
	sendFeedback?( feedback: StudioFeedback ): Promise< { feedbackId: number } >;
}
