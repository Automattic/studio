import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { PreviewCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import { setSnapshotInConfig } from 'cli/lib/cli-config';
import { emitSnapshotEvent } from 'cli/lib/daemon-client';
import { normalizeHostname } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export interface SetCommandOptions {
	name?: string;
}

export async function runCommand( host: string, options: SetCommandOptions ): Promise< void > {
	const { name } = options;
	const logger = new Logger< LoggerAction >();

	if ( name === undefined ) {
		throw new LoggerError( __( 'At least one option (--name) is required.' ) );
	}

	if ( name !== undefined && ! name.trim() ) {
		throw new LoggerError( __( 'Preview site name cannot be empty.' ) );
	}

	logger.reportStart( LoggerAction.SET, __( 'Updating preview site…' ) );
	await setSnapshotInConfig( host, { name } );
	await emitSnapshotEvent( SNAPSHOT_EVENTS.UPDATED, { snapshotUrl: host } );
	logger.reportSuccess( __( 'Preview site updated' ) );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'set <host>',
		describe: __( 'Configure preview site settings' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'host', {
					type: 'string',
					description: __( 'Hostname of the preview site to configure' ),
					demandOption: true,
				} )
				.option( 'name', {
					type: 'string',
					description: __( 'Preview site name' ),
				} )
				.option( 'path', {
					hidden: true,
				} );
		},
		handler: async ( argv ) => {
			try {
				const normalizedHost = normalizeHostname( argv.host );
				await runCommand( normalizedHost, { name: argv.name } );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to configure preview site' ), error );
					logger.reportError( loggerError );
				}
				process.exit( 1 );
			}
		},
	} );
};

const logger = new Logger< LoggerAction >();
