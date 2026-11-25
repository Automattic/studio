import os from 'os';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { readConfig, updateConfig } from '@studio/common/lib/config/store';
import { SITE_BUSY_ERROR_CODE } from '@studio/common/lib/site-operation';
import { getSiteOperationNoun } from '@studio/common/lib/site-operation-labels';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { LoggerError } from 'cli/logger';
import type { ConfigSite } from '@studio/common/lib/config/schema';
import type { SiteOperation, SiteOperationKind } from '@studio/common/lib/site-operation';

function siteBusyError( requested: SiteOperationKind, blockedBy: SiteOperationKind ): LoggerError {
	return new LoggerError(
		sprintf(
			/* translators: 1: operation the user asked for, e.g. "a site start". 2: operation already running, e.g. "a settings change". */
			__(
				'Cannot run %1$s: %2$s is already in progress for this site. Wait for it to finish and try again.'
			),
			getSiteOperationNoun( requested ),
			getSiteOperationNoun( blockedBy )
		),
		undefined,
		SITE_BUSY_ERROR_CODE
	);
}

// Signal 0 only runs the existence and permission checks. EPERM means the
// process exists but belongs to another user, which still counts as alive.
function isProcessAlive( pid: number ): boolean {
	try {
		process.kill( pid, 0 );
		return true;
	} catch ( error ) {
		return ( error as NodeJS.ErrnoException ).code === 'EPERM';
	}
}

// Leaves room for the clock moving between the processes that compare boot times.
const BOOT_TIME_TOLERANCE_MS = 60_000;

function getBootTime(): number {
	return Math.round( Date.now() - os.uptime() * 1000 );
}

// Builds up to 2.4.0 recorded no boot time, so their entries can't be told
// apart from a reused pid and count as stale.
function isOwnerAlive( { pid, bootTime }: SiteOperation ): boolean {
	if ( bootTime === undefined || getBootTime() - bootTime > BOOT_TIME_TOLERANCE_MS ) {
		return false;
	}
	return isProcessAlive( pid );
}

/**
 * The site's operation, or undefined once its owning process has died. Every
 * path that reports a site to a client must go through this — an entry left
 * behind by a crashed process would otherwise keep the site's actions disabled
 * in the UI.
 */
export function getLiveSiteOperation( site: ConfigSite ): SiteOperation | undefined {
	return site.operation && isOwnerAlive( site.operation ) ? site.operation : undefined;
}

const START_WAIT_POLL_INTERVAL_MS = 250;

/**
 * Records the operation against the site, throwing when another one already
 * holds it. Runs inside the config lock so the read-check-write is atomic
 * across CLI processes — the agent, the desktop app and a terminal all reach
 * this through the same commands.
 *
 * A start waits for another process's start instead, and then finds the site
 * running: the Desktop app starts its sites at launch while a CLI that
 * just replaced an outdated daemon starts the same sites again.
 */
async function acquire( siteIds: string[], kind: SiteOperationKind ): Promise< SiteOperation > {
	const operation: SiteOperation = { pid: process.pid, kind, bootTime: getBootTime() };

	for (;;) {
		let isWaiting = false;
		await updateConfig( ( config ) => {
			const sites: ConfigSite[] = [];

			for ( const siteId of siteIds ) {
				const site = config.sites.find( ( candidate ) => candidate.id === siteId );
				if ( ! site ) {
					throw new LoggerError( __( 'Site not found' ) );
				}

				const blocking = getLiveSiteOperation( site );
				if ( kind === 'start' && blocking?.kind === 'start' && blocking.pid !== process.pid ) {
					isWaiting = true;
				} else if ( blocking ) {
					throw siteBusyError( kind, blocking.kind );
				}

				sites.push( site );
			}

			if ( ! isWaiting ) {
				for ( const site of sites ) {
					site.operation = operation;
				}
			}
		} );

		if ( ! isWaiting ) {
			return operation;
		}
		await waitForOtherStarts( siteIds );
	}
}

// Polls without the config lock, which every Studio process shares, until no other process's
// start holds one of the sites.
async function waitForOtherStarts( siteIds: string[] ): Promise< void > {
	const isStartedElsewhere = ( site: ConfigSite ) => {
		const blocking = getLiveSiteOperation( site );
		return blocking?.kind === 'start' && blocking.pid !== process.pid;
	};
	do {
		await new Promise( ( resolve ) => setTimeout( resolve, START_WAIT_POLL_INTERVAL_MS ) );
	} while (
		( await readConfig() ).sites.some(
			( site ) => siteIds.includes( site.id ) && isStartedElsewhere( site )
		)
	);
}

// A long-lived owner (`studio mcp`, the daemon) would otherwise keep a site whose
// release lost the config lock busy until it exits.
const RELEASE_ATTEMPTS = 3;

async function release( siteIds: string[], operation: SiteOperation ): Promise< void > {
	for ( let attempt = 1; ; attempt++ ) {
		try {
			return await clearOperation( siteIds, operation );
		} catch ( error ) {
			if ( attempt === RELEASE_ATTEMPTS ) {
				throw error;
			}
		}
	}
}

function clearOperation( siteIds: string[], operation: SiteOperation ): Promise< void > {
	return updateConfig( ( config ) => {
		for ( const siteId of siteIds ) {
			const site = config.sites.find( ( candidate ) => candidate.id === siteId );

			// A completed `site delete` removes the record entirely; nothing to release.
			if ( site?.operation?.pid === operation.pid ) {
				// Only clear our own: a reclaimed-then-reacquired site belongs to whoever
				// holds it now.
				delete site.operation;
			}
		}
	} );
}

// Both edges matter: without the release, an indicator raised by the daemon's
// own event mid-operation would never clear.
function emitOperationsChanged( siteId: string ): Promise< void > {
	return emitCliEvent( { event: SITE_EVENTS.OPERATIONS_CHANGED, data: { siteId } } );
}

/**
 * Runs `fn` while holding the site, so no other Studio operation can touch it
 * concurrently. The operation is persisted on the site record, letting the UI
 * disable the actions it blocks and the agent read back why one was refused.
 *
 * Addressed by folder because that's how every command receives its site.
 */
export async function withSiteOperation< T >(
	siteFolder: string,
	kind: SiteOperationKind,
	fn: () => Promise< T >
): Promise< T > {
	const { id: siteId } = await getSiteByFolder( siteFolder );
	return withSiteOperations( [ siteId ], kind, fn );
}

/**
 * Acquires all requested sites in one config transaction before running `fn`.
 * This prevents a batch operation from mutating earlier sites before discovering
 * that a later site is missing or busy.
 */
export async function withSiteOperations< T >(
	siteIds: string[],
	kind: SiteOperationKind,
	fn: () => Promise< T >
): Promise< T > {
	const operation = await acquire( siteIds, kind );
	await Promise.all( siteIds.map( emitOperationsChanged ) );

	try {
		return await fn();
	} finally {
		// Releasing must never replace the operation's own failure: if the config
		// lock times out here, `fn`'s error is the one worth seeing.
		try {
			await release( siteIds, operation );
		} catch ( error ) {
			console.error( 'Failed to release the site operation:', error );
		}
		await Promise.all( siteIds.map( emitOperationsChanged ) );
	}
}
