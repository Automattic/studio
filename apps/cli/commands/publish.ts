import { readAuthToken } from '@studio/common/lib/shared-config';
import {
	PublishCommandLoggerAction as LoggerAction,
	PublishCommandLoggerAction,
} from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import { openBrowser } from 'cli/lib/browser';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { generateCheckoutUrl } from 'cli/lib/publish';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< PublishCommandLoggerAction >();

export async function runCommand(
	siteFolder: string,
	remoteSiteIdentifier?: string
): Promise< void > {
	const token = await readAuthToken();
	if ( ! token ) {
		throw new LoggerError(
			__( 'Authentication required. Please log in with `studio auth login`.' )
		);
	}

	logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
	const site = await getSiteByFolder( siteFolder );
	logger.reportSuccess( __( 'Site loaded' ) );

	try {
		openBrowser( generateCheckoutUrl( site, 'studio-publish', { autoOpenPush: true } ) );
		logger.reportSuccess( __( 'Successfully published' ) );
	} finally {
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'publish',
		describe: __( 'Publish your local site to a WordPress.com site' ),
		builder: ( yargs ) => {
			return yargs.option( 'remote-site', {
				type: 'string',
				description: __( 'Remote site URL or ID' ),
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.remoteSite );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Publish failed' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
