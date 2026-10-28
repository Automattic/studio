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

// The site operations the agent's tools run. They belong to the app that runs
// the agent: the CLI implements them with its own commands.
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
}

let host: StudioAgentHost | null = null;

export function setStudioAgentHost( value: StudioAgentHost | null ) {
	host = value;
}

export function studioHost(): StudioAgentHost {
	if ( ! host ) {
		throw new Error( 'No Studio agent host is set. Call setStudioAgentHost() first.' );
	}
	return host;
}
