import { statfs } from 'node:fs/promises';
import { __, _n, sprintf } from '@wordpress/i18n';
import { SITE_PROCESS_PREFIX } from 'cli/lib/types/process-manager-ipc';
import { LoggerError } from 'cli/logger';

type SiteProcess = { name: string; status: string };

// Cap on concurrently running site processes, at roughly 120 MB of memory each.
const MAX_RUNNING_SITES = 36;

// A host can lower the caps for its users, as Studio Cloud does per plan.
function limitFromEnvironment( name: string ): number | undefined {
	const value = Number( process.env[ name ] );
	return Number.isInteger( value ) && value > 0 ? value : undefined;
}

/** The limits the host set, without Studio's own defaults. */
export function getHostSiteLimits(): { sites?: number; runningSites?: number; storageGb?: number } {
	return {
		sites: limitFromEnvironment( 'STUDIO_MAX_SITES' ),
		runningSites: limitFromEnvironment( 'STUDIO_MAX_RUNNING_SITES' ),
		storageGb: limitFromEnvironment( 'STUDIO_MAX_STORAGE_GB' ),
	};
}

function getRunningSiteLimit(): number {
	return limitFromEnvironment( 'STUDIO_MAX_RUNNING_SITES' ) ?? MAX_RUNNING_SITES;
}

export function assertSiteCapacity( processes: Iterable< SiteProcess > ): void {
	const limit = getRunningSiteLimit();
	let runningSites = 0;
	for ( const process of processes ) {
		if ( process.status === 'online' && process.name.startsWith( SITE_PROCESS_PREFIX ) ) {
			runningSites++;
		}
	}
	if ( runningSites >= limit ) {
		throw new Error(
			`CAPACITY_LIMIT_REACHED: Cannot start site. The maximum number of running sites has been reached (${ runningSites }/${ limit }). Stop some running sites first.`
		);
	}
}

/** Refuses a new site once the host's limit on sites (`STUDIO_MAX_SITES`) is reached. */
export function assertSiteCountLimit( sites: readonly unknown[] ): void {
	const limit = limitFromEnvironment( 'STUDIO_MAX_SITES' );
	if ( limit !== undefined && sites.length >= limit ) {
		throw new LoggerError(
			sprintf(
				/* translators: %d: the number of sites the plan allows. */
				_n(
					'Your plan allows %d site. Delete a site to create a new one.',
					'Your plan allows %d sites. Delete a site to create a new one.',
					limit
				),
				limit
			)
		);
	}
}

/**
 * Refuses work that needs more space than the host's storage limit (`STUDIO_MAX_STORAGE_GB`)
 * leaves on the disk holding `directory`. `needed` is only measured when there is a limit.
 */
export async function assertStorageAvailable(
	needed: () => number,
	directory: string
): Promise< void > {
	const limitGb = limitFromEnvironment( 'STUDIO_MAX_STORAGE_GB' );
	if ( limitGb === undefined ) {
		return;
	}
	const bytes = needed();
	const disk = await statfs( directory );
	const available = limitGb * 1024 ** 3 - ( disk.blocks - disk.bfree ) * disk.bsize;
	if ( bytes > available ) {
		const gigabytes = ( value: number ) => ( Math.max( 0, value ) / 1024 ** 3 ).toFixed( 1 );
		throw new LoggerError(
			sprintf(
				/* translators: 1: space needed in GB, e.g. 2.4. 2: space left in GB, e.g. 1.1 */
				__(
					'This needs about %1$s GB of storage and your plan has %2$s GB left. Delete sites you no longer need, then try again.'
				),
				gigabytes( bytes ),
				gigabytes( available )
			),
			undefined,
			'storage_limit'
		);
	}
}
