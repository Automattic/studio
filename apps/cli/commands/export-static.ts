import path from 'path';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { runCommand as startSite } from 'cli/commands/site/start';
import { Mode as StopMode, runCommand as stopSite } from 'cli/commands/site/stop';
import { getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { isSiteRunning } from 'cli/lib/site-utils';
import { exportStaticSite } from 'cli/lib/static-export';
import { untildify } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

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

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'export-static [output-dir]',
		describe: __( 'Export site as static HTML files' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'output-dir', {
					type: 'string',
					description: __( 'Directory to write the static site to' ),
					coerce: ( value: string ) => path.resolve( untildify( value ) ),
				} )
				.option( 'base-url', {
					type: 'string',
					description: __(
						'URL the static site will be hosted at. Links are root-relative when omitted.'
					),
					coerce: ( value: string ) => {
						const url = URL.parse( value );
						if (
							! url ||
							! [ 'http:', 'https:' ].includes( url.protocol ) ||
							url.pathname !== '/'
						) {
							throw new Error(
								__( 'base-url must be an http(s) URL without a path, e.g. https://example.com' )
							);
						}
						return url.origin;
					},
				} )
				.option( 'overwrite', {
					type: 'boolean',
					default: false,
					description: __( 'Replace the contents of a non-empty output directory' ),
				} );
		},
		handler: async ( argv ) => {
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
		},
	} );
};
