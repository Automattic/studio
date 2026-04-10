import { generateCheckoutUrl } from '@studio/common/lib/generate-checkout-url';
import { readAuthToken } from '@studio/common/lib/shared-config';
import {
	PublishCommandLoggerAction as LoggerAction,
	PublishCommandLoggerAction,
} from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import { openBrowser } from 'cli/lib/browser';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< PublishCommandLoggerAction >();

export async function runCommand(
	siteFolder: string,
	remoteSiteIdentifier?: string
): Promise< void > {
	try {
		const token = await readAuthToken();
		if ( ! token ) {
			throw new LoggerError(
				__( 'Authentication required. Please log in with `studio auth login`.' )
			);
		}

		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		const site = await getSiteByFolder( siteFolder );
		logger.reportSuccess( __( 'Site loaded' ) );

		await openBrowser( generateCheckoutUrl( site, 'studio-publish', { autoOpenPush: true } ) );
		logger.reportStart(
			LoggerAction.WAITING_FOR_SETUP,
			__( 'Waiting for site setup to complete in the browser…' )
		);
		await new Promise( () => {} );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to publish site' ), error );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'publish',
		describe: __( 'Publish your local site to a WordPress.com site' ),
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
