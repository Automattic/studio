import { __, sprintf } from '@wordpress/i18n';
import { getAuthToken, readAppdata } from 'cli/lib/appdata';
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

		// Get the local site (either by ID or from current directory)
		const localSite = await getSiteForSync( localSiteId );

		// Load appdata
		const appdata = await readAppdata();

		// Find connected sites for this local site
		const connectedSites = appdata.connectedWpcomSites?.[ userId ] || [];
		const syncSite = connectedSites.find( ( site ) => site.localSiteId === localSite.id );

		if ( ! syncSite ) {
			logger.reportSuccess(
				sprintf(
					__( 'Site "%s" is not connected to WordPress.com' ),
					localSite.name || localSite.id
				)
			);
			console.log(
				__( '\nUse "studio sync connect" to connect to a remote site' )
			);
			return;
		}

		// Display status
		console.log( '\n' + sprintf( __( 'Sync Status for "%s"' ), localSite.name || localSite.id ) );
		console.log( __( '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' ) );
		console.log( sprintf( __( 'Remote Site: %s' ), syncSite.name ) );
		console.log( sprintf( __( 'Remote URL: %s' ), syncSite.url ) );
		console.log(
			sprintf(
				__( 'Environment: %s' ),
				syncSite.isStaging
					? __( 'Staging' )
					: syncSite.isPressable
						? __( 'Pressable' )
						: __( 'Production' )
			)
		);
		console.log(
			sprintf(
				__( 'Last Pull: %s' ),
				syncSite.lastPullTimestamp
					? new Date( syncSite.lastPullTimestamp ).toLocaleString()
					: __( 'Never' )
			)
		);
		console.log(
			sprintf(
				__( 'Last Push: %s' ),
				syncSite.lastPushTimestamp
					? new Date( syncSite.lastPushTimestamp ).toLocaleString()
					: __( 'Never' )
			)
		);
		console.log( '' );

		logger.reportSuccess( __( 'Sync status retrieved' ) );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to get sync status' ), error ) );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'status [local-site-id]',
		describe: __( 'Show sync status for a local site' ),
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
