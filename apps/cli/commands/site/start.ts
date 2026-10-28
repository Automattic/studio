import { checkMaintenanceFile } from '@studio/common/lib/maintenance-file';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder, updateSiteLatestCliPid } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { getSiteDetails } from 'cli/lib/site-details';
import { withSiteOperation } from 'cli/lib/site-operations';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { isServerRunning, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import type { builder } from 'cli/commands/site/start.command';
import type { CommandArgs } from 'cli/types';

const defaultLogger = new Logger< LoggerAction >();

export async function runCommand(
	sitePath: string,
	skipBrowser = false,
	skipLogDetails = false,
	logger: Logger< LoggerAction > = defaultLogger
): Promise< void > {
	return withSiteOperation( sitePath, 'start', () =>
		startSite( sitePath, skipBrowser, skipLogDetails, logger )
	);
}

async function startSite(
	sitePath: string,
	skipBrowser: boolean,
	skipLogDetails: boolean,
	logger: Logger< LoggerAction >
): Promise< void > {
	try {
		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connectToDaemon();
		logger.reportSuccess( __( 'Process daemon started' ) );

		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		const site = await getSiteByFolder( sitePath );
		logger.reportSuccess( __( 'Site loaded' ) );

		// A site mid-pull (`pulling`) or whose last pull failed
		// (`pull-failed`) is not a healthy install — its directory may be
		// partially written. Refuse to start it rather than serve a broken
		// site; recovery is to re-run the (idempotent) pull or delete it.
		if ( site.status !== 'ready' ) {
			const detail =
				site.status === 'pulling'
					? __( 'A pull is in progress or was interrupted before it finished.' )
					: __( 'Its last pull failed and the site is incomplete.' );
			throw new LoggerError(
				sprintf(
					// translators: %s: explanation of why the site is not ready to start.
					__(
						'This site is not ready to start. %s Re-run `studio pull-reprint` to finish the pull, or `studio delete` to remove the site.'
					),
					detail
				)
			);
		}

		const runningProcess = await isServerRunning( site.id );
		if ( runningProcess ) {
			logger.reportSuccess( __( 'WordPress server is already running' ) );
			if ( runningProcess.status === 'online' ) {
				await updateSiteLatestCliPid( site.id, runningProcess.pid );
			}
			if ( ! skipBrowser ) {
				await openSiteInBrowser( site );
			}
			if ( ! skipLogDetails ) {
				logSiteDetails( site );
			}
			return;
		}

		await setupCustomDomain( site, logger );

		logger.reportStart(
			LoggerAction.INSTALL_SQLITE,
			__( 'Setting up SQLite integration, if needed…' )
		);
		await keepSqliteIntegrationUpdated( sitePath );
		logger.reportSuccess( __( 'SQLite integration configured as needed' ) );

		const maintenanceCheck = checkMaintenanceFile( sitePath );
		if ( maintenanceCheck.exists && ! maintenanceCheck.isStale ) {
			throw new LoggerError(
				__(
					'This site is in maintenance mode. WordPress is currently performing an update. The maintenance lock should expire automatically within 10 minutes. Please wait and try again.'
				)
			);
		}

		logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress server…' ) );
		try {
			await startWordPressServer( site, logger );

			logger.reportSuccess( __( 'WordPress server started' ) );

			if ( ! skipLogDetails ) {
				logSiteDetails( site );
			}

			if ( ! skipBrowser ) {
				await openSiteInBrowser( site );
			}
		} catch ( error ) {
			throw new LoggerError( __( 'Failed to start WordPress server' ), error );
		}
	} finally {
		await disconnectFromDaemon();
	}
}
export async function commandHandler( argv: CommandArgs< typeof builder > ) {
	try {
		await runCommand( argv.path, argv.skipBrowser, argv.skipLogDetails );
		// Read after the operation is released, so Studio can show the site as it now is.
		defaultLogger.reportResult( {
			...getSiteDetails( await getSiteByFolder( argv.path ) ),
			running: true,
		} );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			defaultLogger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to start site' ), error );
			defaultLogger.reportError( loggerError );
		}
	}
}
