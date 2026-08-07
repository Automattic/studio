import { randomUUID } from 'crypto';
import os from 'os';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import {
	conflictsWith,
	SITE_OPERATION_MAX_AGE_MS,
	type SiteOperation,
	type SiteOperationKind,
} from '@studio/common/lib/site-operation';
import { getSiteOperationNoun } from '@studio/common/lib/site-operation-labels';
import { __, sprintf } from '@wordpress/i18n';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
	type SiteData,
} from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { LoggerError } from 'cli/logger';

function siteBusyError( requested: SiteOperationKind, blockedBy: SiteOperationKind ): LoggerError {
	return new LoggerError(
		sprintf(
			/* translators: 1: operation the user asked for, e.g. "a site start". 2: operation already running, e.g. "an import". */
			__(
				'Cannot run %1$s: %2$s is already in progress for this site. Wait for it to finish and try again.'
			),
			getSiteOperationNoun( requested ),
			getSiteOperationNoun( blockedBy )
		)
	);
}

// A lease is only as good as its owner. `signal 0` performs the permission and
// existence checks without delivering anything; EPERM means the process is
// alive but owned by someone else, which still counts as held.
function isProcessAlive( pid: number ): boolean {
	try {
		process.kill( pid, 0 );
		return true;
	} catch ( error ) {
		return ( error as NodeJS.ErrnoException ).code === 'EPERM';
	}
}

/**
 * The site's leases minus any whose owning process has died. Every path that
 * reports a site to a client must filter through this: clients disable actions
 * on what they see, so a leaked lease from a crashed process would disable the
 * site forever — including the operations whose acquire would have reclaimed it.
 */
export function getLiveSiteOperations( site: SiteData, now = Date.now() ): SiteOperation[] {
	// PIDs restart from scratch after a reboot, so a lease written before this
	// boot can match an unrelated process and look held. `cli.json` outlives the
	// machine; the processes in it don't.
	const bootedAt = now - os.uptime() * 1000;

	return ( site.operations ?? [] ).filter(
		( operation ) =>
			operation.startedAt >= bootedAt &&
			now - operation.startedAt < SITE_OPERATION_MAX_AGE_MS &&
			isProcessAlive( operation.pid )
	);
}

/**
 * Claims a lease on the site, throwing when a conflicting one
 * is already held. Runs inside the config lock so the read-check-write is
 * atomic against other CLI processes — the agent, the desktop app and a
 * terminal all reach this through the same commands.
 */
async function acquire( siteId: string, kind: SiteOperationKind ): Promise< SiteOperation > {
	const operation: SiteOperation = {
		id: randomUUID(),
		pid: process.pid,
		kind,
		startedAt: Date.now(),
	};

	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const site = config.sites.find( ( s ) => s.id === siteId );

		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}

		const held = getLiveSiteOperations( site );
		const blocking = held.find( ( existing ) => conflictsWith( existing.kind, kind ) );
		if ( blocking ) {
			throw siteBusyError( kind, blocking.kind );
		}

		site.operations = [ ...held, operation ];
		await saveCliConfig( config );
	} finally {
		await unlockCliConfig();
	}

	return operation;
}

async function release( siteId: string, operation: SiteOperation ): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const site = config.sites.find( ( s ) => s.id === siteId );

		// A completed `site delete` removes the record entirely; nothing to release.
		if ( ! site ) {
			return;
		}

		const remaining = getLiveSiteOperations( site ).filter(
			( existing ) => existing.id !== operation.id
		);
		if ( remaining.length > 0 ) {
			site.operations = remaining;
		} else {
			delete site.operations;
		}
		await saveCliConfig( config );
	} finally {
		await unlockCliConfig();
	}
}

/**
 * Runs `fn` while holding a lease on the site so no other Studio operation can
 * touch it concurrently. The lease is persisted on the site record, so the UI
 * can disable the actions it blocks and the agent gets a readable error.
 *
 * Addressed by folder because that's how every command receives its site.
 */
export async function withSiteLock< T >(
	siteFolder: string,
	kind: SiteOperationKind,
	fn: () => Promise< T >
): Promise< T > {
	const { id: siteId } = await getSiteByFolder( siteFolder );
	const operation = await acquire( siteId, kind );
	await emitCliEvent( { event: SITE_EVENTS.UPDATED, data: { siteId } } );

	try {
		return await fn();
	} finally {
		// Never let releasing the lease replace the operation's own failure: if
		// the config lock times out here, `fn`'s error is the one worth seeing.
		try {
			await release( siteId, operation );
		} catch ( error ) {
			console.error( 'Failed to release the site operation lease:', error );
		}
		await emitCliEvent( { event: SITE_EVENTS.UPDATED, data: { siteId } } );
	}
}
