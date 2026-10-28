import type { SiteInfo } from './types';
import type { StudioChatArtifactData } from '@studio/agent/protocol/chat-artifacts';
import type { TracksEventName, TracksProps } from '@studio/common/lib/record-tracks-event';

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

// What a host command printed: its console output, its progress messages, and
// the exit code it set. Tools build their results from it, so they read the
// same whichever host ran the command.
export interface CommandOutput {
	consoleOutput: string;
	progressOutput: string;
	exitCode: number | undefined;
}

export interface WpCliOutput {
	exitCode: number;
	stdout: string;
	stderr: string;
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
// user.
export interface StudioAgentHost {
	// The folder Studio's sites live in. The file tools are rooted here.
	sitesRoot: string;
	// The User-Agent requests to WordPress.com carry, naming the app and its version.
	userAgent: string;
	sites: {
		resolve( nameOrPath: string ): Promise< HostSite >;
		findByFolder( folder: string ): Promise< HostSite | undefined >;
		all(): Promise< HostSite[] >;
		// The local sites as JSON, as `site list --format json` prints them.
		list(): Promise< string >;
		// The site's details as JSON, as `site status --format json` prints them.
		status( site: HostSite ): Promise< string >;
		create( name: string, sitePath: string, onProgress: ProgressCallback ): Promise< void >;
		start( site: HostSite, onProgress: ProgressCallback ): Promise< void >;
		stop( site: HostSite, onProgress: ProgressCallback ): Promise< void >;
		delete( site: HostSite, deleteFiles: boolean, onProgress: ProgressCallback ): Promise< void >;
		isRunning( site: HostSite ): Promise< boolean >;
		import( site: HostSite, file: string, onProgress: ProgressCallback ): Promise< CommandOutput >;
		export(
			site: HostSite,
			file: string,
			mode: 'full' | 'db',
			onProgress: ProgressCallback
		): Promise< CommandOutput >;
		wpCli( site: HostSite, args: string[] ): Promise< WpCliOutput >;
	};
	previews: {
		// The site's previews as JSON, as `preview list --format json` prints them.
		list( site: HostSite ): Promise< string >;
		create( site: HostSite, onProgress: ProgressCallback ): Promise< CommandOutput >;
		update(
			site: HostSite,
			hostname: string,
			overwrite: boolean,
			onProgress: ProgressCallback
		): Promise< CommandOutput >;
		delete( hostname: string, onProgress: ProgressCallback ): Promise< CommandOutput >;
	};
	sync: {
		push(
			site: HostSite,
			options: string,
			remoteSite: string | undefined,
			onProgress: ProgressCallback
		): Promise< CommandOutput >;
		pull(
			site: HostSite,
			options: string,
			remoteSite: string | undefined,
			onProgress: ProgressCallback
		): Promise< CommandOutput >;
	};
	wpcom: {
		sites( accessToken: string ): Promise< unknown[] >;
	};
	tracks: {
		record( event: TracksEventName, props: TracksProps ): Promise< void >;
	};
	// Makes a site the agent created the conversation's site.
	selectSite?( site: SiteInfo ): Promise< void > | void;
	// Where screenshots are saved; a temporary folder when absent or null.
	screenshotsDirectory?(): Promise< string | null > | string | null;
	// Present when an app shows the conversation. Tools that only make sense
	// there, and their mentions in the prompt, depend on it.
	ui?: StudioAgentUi;
}
