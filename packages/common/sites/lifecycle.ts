import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import {
	SITE_START_REQUESTED_AT_ENV,
	siteListItemSchema,
	type SiteListItem,
} from '@studio/common/lib/cli-events';
import {
	CliCommandError,
	runCliCommand,
	type ExecuteCliCommand,
} from '@studio/common/lib/cli-process';
import { getProxyPortConflictMessage } from '@studio/common/lib/domains';
import { checkMaintenanceFile } from '@studio/common/lib/maintenance-file';
import { SITE_BUSY_ERROR_CODE } from '@studio/common/lib/site-operation';

// Start / stop / delete a local site via the Studio CLI's one-shot `site`
// commands, for the desktop main process and the `studio ui` server alike.

// Each command reports a result once it finishes: start and stop the site as it
// is then, so the caller can show it without waiting for the matching site event.
async function runSiteCommand< T >(
	execute: ExecuteCliCommand,
	args: string[],
	schema: z.ZodType< T >,
	baseMessage: string,
	env?: NodeJS.ProcessEnv
): Promise< T > {
	try {
		return await runCliCommand( execute, args, schema, { env } );
	} catch ( error ) {
		if ( error instanceof CliCommandError ) {
			error.baseMessage = baseMessage;
		}
		throw error;
	}
}

/** The site can't start for an expected reason that its message explains to the user. */
export class SiteStartRefusedError extends Error {}

/** Start a local site's server via the Studio CLI. Resolves when it's already running. */
export async function startSite(
	execute: ExecuteCliCommand,
	sitePath: string
): Promise< SiteListItem > {
	const requestedAt = Date.now();
	const maintenance = checkMaintenanceFile( sitePath );
	if ( maintenance.exists && ! maintenance.isStale ) {
		throw new SiteStartRefusedError(
			__(
				'This site is in maintenance mode. WordPress is currently performing an update. The maintenance lock should expire automatically within 10 minutes. Please wait and try again.'
			)
		);
	}
	try {
		return await runSiteCommand(
			execute,
			[ 'site', 'start', '--path', sitePath, '--skip-browser', '--skip-log-details' ],
			siteListItemSchema,
			'Failed to start site',
			// Lets the CLI time the start from here, not from when its own process got going.
			{ [ SITE_START_REQUESTED_AT_ENV ]: String( requestedAt ) }
		);
	} catch ( error ) {
		const { lastErrorMessage, lastErrorCode } = error as Partial< CliCommandError >;
		if ( lastErrorMessage && lastErrorCode === SITE_BUSY_ERROR_CODE ) {
			throw new SiteStartRefusedError( lastErrorMessage );
		}
		if ( lastErrorMessage?.includes( 'CAPACITY_LIMIT_REACHED' ) ) {
			throw new SiteStartRefusedError(
				__(
					'The maximum number of running sites has been reached. Stop some running sites before starting new ones.'
				)
			);
		}
		const proxyPortConflict = lastErrorMessage && getProxyPortConflictMessage( lastErrorMessage );
		if ( proxyPortConflict ) {
			throw new SiteStartRefusedError( proxyPortConflict );
		}
		throw lastErrorMessage ? new Error( lastErrorMessage ) : error;
	}
}

/** Stop a local site's server via the Studio CLI. */
export function stopSite( execute: ExecuteCliCommand, sitePath: string ): Promise< SiteListItem > {
	return runSiteCommand(
		execute,
		[ 'site', 'stop', '--path', sitePath ],
		siteListItemSchema,
		'Failed to stop site'
	);
}

const deleteSiteResultSchema = z.object( { warnings: z.array( z.string() ) } );

/**
 * Remove a site from Studio via the Studio CLI, trashing its files unless `deleteFiles` is false.
 * `warnings` names what the delete left behind, such as files it could not move to trash.
 */
export function deleteSite(
	execute: ExecuteCliCommand,
	sitePath: string,
	deleteFiles: boolean
): Promise< z.infer< typeof deleteSiteResultSchema > > {
	return runSiteCommand(
		execute,
		[ 'site', 'delete', '--path', sitePath, deleteFiles ? '--files' : '--no-files' ],
		deleteSiteResultSchema,
		'Failed to delete site'
	);
}
