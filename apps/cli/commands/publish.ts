import { generateCheckoutUrl } from '@studio/common/lib/generate-checkout-url';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { getAppConfigPath } from '@studio/common/lib/well-known-paths';
import {
	PublishCommandLoggerAction as LoggerAction,
	PublishCommandLoggerAction,
} from '@studio/common/logger-actions';
import { SyncSite } from '@studio/common/types/sync';
import { __ } from '@wordpress/i18n';
import { readFile } from 'atomically';
import { openBrowser } from 'cli/lib/browser';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

async function isSiteAlreadyConnected( localSiteId: string, userId: number ): Promise< boolean > {
	let raw: string;

	try {
		raw = await readFile( getAppConfigPath(), 'utf-8' );
	} catch {
		return false;
	}

	let parsed: { connectedWpcomSites?: { [ userId: number ]: SyncSite[] } };
	try {
		parsed = JSON.parse( raw );
	} catch {
		return false;
	}

	const connections = parsed.connectedWpcomSites?.[ userId ] ?? [];
	return connections.some( ( site ) => site.localSiteId === localSiteId );
}

const logger = new Logger< PublishCommandLoggerAction >();

export async function runCommand( siteFolder: string ): Promise< void > {
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

		if ( await isSiteAlreadyConnected( site.id, token.id ) ) {
			throw new LoggerError(
				__( 'This site is already published and cannot be published again.' )
			);
		}

		const checkoutUrl = generateCheckoutUrl( site, 'studio-publish', { autoOpenPush: true } );
		await openBrowser( checkoutUrl );
		logger.reportSuccess(
			__( 'Follow the procedure on the site to finish publishing your site.' )
		);
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
				await runCommand( argv.path );
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
