import type { SiteInfo } from './types';
import type { StudioChatArtifactData } from '@studio/agent/protocol/chat-artifacts';
import type { SiteListItem } from '@studio/common/lib/cli-events';
import type { TracksEventName, TracksProps } from '@studio/common/lib/record-tracks-event';
import type { FrontendCreateChoice, SiteFrontend } from '@studio/common/lib/site-frontend';
import type { SiteStatus } from '@studio/common/types/site-status';
import type { Snapshot } from '@studio/common/types/snapshot';
import type { SyncSite } from '@studio/common/types/sync';

export type ProgressCallback = ( message: string, update?: boolean ) => void;

// A local site as the agent's tools see it.
export interface HostSite {
	id: string;
	name: string;
	path: string;
	url: string;
	phpVersion: string;
	adminPassword?: string;
	// Present for headless sites.
	frontend?: SiteFrontend;
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
		// With `frontend`, creates a headless site: WordPress plus a frontend project.
		create(
			name: string,
			sitePath: string,
			onProgress: ProgressCallback,
			options?: { frontend?: FrontendCreateChoice }
		): Promise< void >;
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
		// Headless sites only: restarts the frontend process Studio supervises.
		frontendRestart( site: HostSite, onProgress: ProgressCallback ): Promise< void >;
		// Headless sites only: the last `lines` lines of the frontend's output.
		frontendLogs( site: HostSite, lines: number ): Promise< string >;
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
