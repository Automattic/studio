import { SITE_EVENTS } from '@studio/common/lib/cli-events';
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
		)
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

/**
 * The site's operation, or undefined once its owning process has died. Every
 * path that reports a site to a client must go through this — an entry left
 * behind by a crashed process would otherwise keep the site's actions disabled
 * in the UI.
 */
export function getLiveSiteOperation( site: SiteData ): SiteOperation | undefined {
	return site.operation && isProcessAlive( site.operation.pid ) ? site.operation : undefined;
}

/**
 * Records the operation against the site, throwing when another one already
 * holds it. Runs inside the config lock so the read-check-write is atomic
 * across CLI processes — the agent, the desktop app and a terminal all reach
 * this through the same commands.
 */
async function acquire( siteId: string, kind: SiteOperationKind ): Promise< SiteOperation > {
	const operation: SiteOperation = { pid: process.pid, kind };

	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const site = config.sites.find( ( s ) => s.id === siteId );

		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}

		const blocking = getLiveSiteOperation( site );
		if ( blocking ) {
			throw siteBusyError( kind, blocking.kind );
		}

		site.operation = operation;
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

		// Only clear our own: a reclaimed-then-reacquired site belongs to whoever
		// holds it now.
		if ( site.operation?.pid === operation.pid ) {
			delete site.operation;
		}
		await saveCliConfig( config );
	} finally {
		await unlockCliConfig();
	}
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
	const operation = await acquire( siteId, kind );
	await emitOperationsChanged( siteId );

	try {
		return await fn();
	} finally {
		// Releasing must never replace the operation's own failure: if the config
		// lock times out here, `fn`'s error is the one worth seeing.
		try {
			await release( siteId, operation );
		} catch ( error ) {
			console.error( 'Failed to release the site operation:', error );
		}
		await emitOperationsChanged( siteId );
	}
}
