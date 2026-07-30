import { listAiSessions } from '@studio/common/ai/sessions/store';
import { getSessionsDirectory } from '@studio/common/lib/well-known-paths';
import { __ } from '@wordpress/i18n';
import { displaySessionsCompact } from 'cli/commands/ai/sessions/helpers';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

type SessionOutputFormat = 'compact' | 'json';

export async function runCommand( format: SessionOutputFormat ): Promise< void > {
	const sessions = await listAiSessions( getSessionsDirectory() );

	if ( format === 'json' ) {
		console.log( JSON.stringify( sessions, null, 2 ) );
		return;
	}

	if ( sessions.length === 0 ) {
		console.log( __( 'No code sessions found' ) );
		return;
	}

	displaySessionsCompact( sessions );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'list',
		describe: __( 'List code sessions' ),
		builder: ( listYargs ) => {
			return listYargs.option( 'format', {
				type: 'string',
				choices: [ 'compact', 'json' ] as const,
				default: 'compact' as const,
				description: __( 'Output format' ),
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.format as SessionOutputFormat );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError( new LoggerError( __( 'Failed to list code sessions' ), error ) );
				}
			}
		},
	} );
};
