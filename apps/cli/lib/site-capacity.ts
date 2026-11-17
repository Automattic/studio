import { SITE_PROCESS_PREFIX } from 'cli/lib/types/process-manager-ipc';

type SiteProcess = { name: string; status: string };

// Cap on concurrently running site processes, at roughly 120 MB of memory each.
const MAX_RUNNING_SITES = 36;

export function assertSiteCapacity( processes: Iterable< SiteProcess > ): void {
	let runningSites = 0;
	for ( const process of processes ) {
		if ( process.status === 'online' && process.name.startsWith( SITE_PROCESS_PREFIX ) ) {
			runningSites++;
		}
	}
	if ( runningSites >= MAX_RUNNING_SITES ) {
		throw new Error(
			`CAPACITY_LIMIT_REACHED: Cannot start site. The maximum number of running sites has been reached (${ runningSites }/${ MAX_RUNNING_SITES }). Stop some running sites first.`
		);
	}
}
