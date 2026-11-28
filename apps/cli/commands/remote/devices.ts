import { listRemoteDevices, revokeRemoteDevice } from '@studio/common/lib/remote-access';
import { __ } from '@wordpress/i18n';
import CliTable3 from 'cli-table3';
import { format } from 'date-fns/format';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runListCommand( outputFormat: 'table' | 'json' ): Promise< void > {
	const logger = new Logger< string >();
	try {
		const devices = await listRemoteDevices();

		if ( outputFormat === 'json' ) {
			console.log( JSON.stringify( devices ) );
			logger.reportResult( devices );
			return;
		}
		if ( devices.length === 0 ) {
			logger.reportSuccess( __( 'No paired devices' ) );
			return;
		}

		const table = new CliTable3( {
			head: [ __( 'ID' ), __( 'Name' ), __( 'Platform' ), __( 'Paired' ), __( 'Last seen' ) ],
			style: { head: [], border: [] },
		} );
		for ( const device of devices ) {
			table.push( [
				device.id,
				device.name,
				device.platform,
				format( device.pairedAt, 'yyyy-MM-dd HH:mm' ),
				format( device.lastSeenAt, 'yyyy-MM-dd HH:mm' ),
			] );
		}
		console.log( table.toString() );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to load paired devices' ), error ) );
		}
	}
}

export async function runRevokeCommand( deviceId: string ): Promise< void > {
	const logger = new Logger< string >();
	try {
		if ( await revokeRemoteDevice( deviceId ) ) {
			logger.reportSuccess( __( 'Device revoked' ) );
			return;
		}
		logger.reportError( new LoggerError( __( 'No paired device has that ID' ) ) );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to revoke the device' ), error ) );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( 'devices', __( 'Manage paired devices' ), ( devicesYargs ) => {
		devicesYargs
			.command( {
				command: 'list',
				describe: __( 'List paired devices' ),
				builder: ( listYargs ) =>
					listYargs.option( 'format', {
						type: 'string',
						choices: [ 'table', 'json' ] as const,
						default: 'table' as const,
						description: __( 'Output format' ),
					} ),
				handler: async ( argv ) => {
					await runListCommand( argv.format as 'table' | 'json' );
				},
			} )
			.command( {
				command: 'revoke <id>',
				describe: __( 'Unpair a device' ),
				builder: ( revokeYargs ) =>
					revokeYargs.positional( 'id', {
						type: 'string',
						demandOption: true,
						description: __( 'ID of the device, from `studio remote devices list`' ),
					} ),
				handler: async ( argv ) => {
					await runRevokeCommand( argv.id as string );
				},
			} )
			.version( false )
			.demandCommand( 1, __( 'You must provide a valid command' ) );
	} );
};
