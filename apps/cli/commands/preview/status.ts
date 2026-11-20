import { __ } from '@wordpress/i18n';
import { getDestinationStatus } from 'cli/commands/publish-status';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'status <host>',
		describe: __( 'Show whether a preview site or its local site changed since they were synced' ),
		builder: ( yargs ) =>
			yargs
				.positional( 'host', {
					type: 'string',
					description: __( 'Hostname of the preview site' ),
					demandOption: true,
				} )
				.option( 'path', { hidden: true } ),
		handler: async ( argv ) => {
			const logger = new Logger< string >();
			try {
				const status = await getDestinationStatus( { host: argv.host } );
				console.log( JSON.stringify( status ) );
				logger.reportResult( status );
			} catch ( error ) {
				logger.reportError(
					error instanceof LoggerError
						? error
						: new LoggerError( __( 'Failed to check the preview site' ), error )
				);
				process.exit( 1 );
			}
		},
	} );
};
