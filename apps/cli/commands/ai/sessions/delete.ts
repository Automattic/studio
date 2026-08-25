import { deleteAiSession, listAiSessions } from '@studio/common/ai/sessions/store';
import { getSessionsDirectory } from '@studio/common/lib/well-known-paths';
import { __ } from '@wordpress/i18n';
import { chooseSessionForAction } from 'cli/commands/ai/sessions/helpers';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

export async function runCommand( sessionIdOrPrefix?: string ): Promise< void > {
	let resolvedSessionIdOrPrefix = sessionIdOrPrefix?.trim();

	if ( ! resolvedSessionIdOrPrefix ) {
		const selectedSession = await chooseSessionForAction(
			__( 'Select a session to delete:' ),
			__( 'No code sessions found' )
		);
		if ( ! selectedSession ) {
			return;
		}

		resolvedSessionIdOrPrefix = selectedSession.id;
	}

	if ( resolvedSessionIdOrPrefix.toLowerCase() === 'latest' ) {
		const sessions = await listAiSessions( getSessionsDirectory() );
		if ( sessions.length === 0 ) {
			throw new Error( __( 'No code sessions found' ) );
		}

		resolvedSessionIdOrPrefix = sessions[ 0 ].id;
	}

	const deletedSession = await deleteAiSession( getSessionsDirectory(), resolvedSessionIdOrPrefix );
	console.log( `${ __( 'Deleted code session' ) }: ${ deletedSession.id }` );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'delete [id]',
		describe: __( 'Delete a code session (id, prefix, "latest", or picker)' ),
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
					logger.reportError( new LoggerError( __( 'Failed to delete code session' ), error ) );
				}
			}
		},
	} );
};
