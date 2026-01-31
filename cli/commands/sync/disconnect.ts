import { __, sprintf } from '@wordpress/i18n';
import { getAuthToken, lockAppdata, readAppdata, saveAppdata, unlockAppdata } from 'cli/lib/appdata';
import { getSiteForSync } from 'cli/lib/sync-helpers';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand( localSiteId?: string ): Promise< void > {
	const logger = new Logger();

	try {
		// Get auth token
		let userId: number;
		try {
			const token = await getAuthToken();
			userId = token.id;
		} catch {
			logger.reportError(
				new LoggerError(
					__(
						'Authentication required. Please log in to WordPress.com first:\n\n  studio auth login'
					)
				)
			);
			return;
		}

		// Get the local site
		const localSite = await getSiteForSync( localSiteId );

		logger.reportStart( undefined, __( 'Disconnecting site…' ) );

		// Lock and read appdata
		await lockAppdata();
		try {
			const appdata = await readAppdata();

			// Find connected sites
			const connectedSites = appdata.connectedWpcomSites?.[ userId ] || [];
			const syncSiteIndex = connectedSites.findIndex(
				( site ) => site.localSiteId === localSite.id
			);

			if ( syncSiteIndex === -1 ) {
				logger.reportWarning(
					sprintf(
						__( 'Site "%s" is not connected to WordPress.com' ),
						localSite.name || localSite.id
					)
				);
				return;
			}

			// Remove the connection
			connectedSites.splice( syncSiteIndex, 1 );

			// Update appdata
			if ( ! appdata.connectedWpcomSites ) {
				appdata.connectedWpcomSites = {};
			}
			appdata.connectedWpcomSites[ userId ] = connectedSites;

			await saveAppdata( appdata );

			logger.reportSuccess(
				sprintf(
					__( 'Successfully disconnected "%s" from WordPress.com' ),
					localSite.name || localSite.id
				)
			);
		} finally {
			await unlockAppdata();
		}
	} catch ( error ) {
		logger.spinner.stop();
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to disconnect site' ), error ) );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'disconnect [local-site-id]',
		describe: __( 'Disconnect a local site from WordPress.com' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'local-site-id', {
					describe: __( 'ID of the local site (optional if run from site directory)' ),
					type: 'string',
				} )
				.option( 'path', {
					hidden: true,
				} );
		},
		handler: async ( argv ) => {
			await runCommand( argv[ 'local-site-id' ] as string | undefined );
		},
	} );
};
