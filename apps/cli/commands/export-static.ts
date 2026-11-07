import path from 'path';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { runCommand as startSite } from 'cli/commands/site/start';
import { Mode as StopMode, runCommand as stopSite } from 'cli/commands/site/stop';
import { getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { isSiteRunning } from 'cli/lib/site-utils';
import { exportStaticSite } from 'cli/lib/static-export';
import { Logger, LoggerError } from 'cli/logger';
import type { builder } from 'cli/commands/export-static.command';
import type { CommandArgs } from 'cli/types';

const logger = new Logger< LoggerAction >();

export async function runCommand(
	sitePath: string,
	outputDir: string,
	destinationUrl: string | undefined,
	overwrite: boolean
): Promise< void > {
	const site = await getSiteByFolder( sitePath );

	await connectToDaemon();
	const wasRunning = await isSiteRunning( site );
	await disconnectFromDaemon();

	// Pages are rendered by the running site, so start it for the export if needed.
	if ( ! wasRunning ) {
		await startSite( sitePath, true, true, logger );
	}

	try {
		logger.reportStart( LoggerAction.EXPORT_SITE, __( 'Generating static site…' ) );
		await exportStaticSite( {
			site,
			sourceUrl: getSiteUrl( site ),
			outputDir,
			destinationUrl,
			overwrite,
			onProgress: ( message ) => logger.reportProgress( message ),
		} );
		logger.reportSuccess( sprintf( __( 'Static site exported to %s' ), outputDir ) );
	} finally {
		if ( ! wasRunning ) {
			await stopSite( StopMode.STOP_SINGLE_SITE, sitePath, logger );
		}
	}
}

export async function commandHandler( argv: CommandArgs< typeof builder > ) {
	try {
		const outputDir =
			argv.outputDir ?? path.join( process.cwd(), `${ path.basename( argv.path ) }-static` );
		await runCommand( argv.path, outputDir, argv.baseUrl, argv.overwrite );
	} catch ( error ) {
		logger.reportError(
			error instanceof LoggerError
				? error
				: new LoggerError( __( 'Failed to export static site' ), error )
		);
	}
}
