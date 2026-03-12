import { __ } from '@wordpress/i18n';
import { deleteAiSession, listAiSessions } from 'cli/ai/sessions';
import { chooseSessionForAction } from 'cli/commands/ai/sessions/helpers';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

export async function runCommand( sessionIdOrPrefix?: string ): Promise< void > {
	let resolvedSessionIdOrPrefix = sessionIdOrPrefix?.trim();

	if ( ! resolvedSessionIdOrPrefix ) {
		const selectedSession = await chooseSessionForAction(
			__( 'Select a session to delete:' ),
			__( 'No AI sessions found' )
		);
		if ( ! selectedSession ) {
			return;
		}

		resolvedSessionIdOrPrefix = selectedSession.id;
	}

	if ( resolvedSessionIdOrPrefix.toLowerCase() === 'latest' ) {
		const sessions = await listAiSessions();
		if ( sessions.length === 0 ) {
			throw new Error( __( 'No AI sessions found' ) );
		}

		resolvedSessionIdOrPrefix = sessions[ 0 ].id;
	}

	const deletedSession = await deleteAiSession( resolvedSessionIdOrPrefix );
	console.log( `${ __( 'Deleted AI session' ) }: ${ deletedSession.id }` );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'delete [id]',
		describe: __( 'Delete an AI session (id, prefix, "latest", or picker)' ),
		builder: ( deleteYargs ) => {
			return deleteYargs.positional( 'id', {
				type: 'string',
				describe: __( 'Session id, id prefix, or "latest"' ),
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( typeof argv.id === 'string' ? argv.id : undefined );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError( new LoggerError( __( 'Failed to delete AI session' ), error ) );
				}
			}
		},
	} );
};
