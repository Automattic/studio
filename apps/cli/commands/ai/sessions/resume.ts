import { __ } from '@wordpress/i18n';
import { InteractiveAdapter } from 'cli/ai/output-adapter';
import { listAiSessions, loadAiSession } from 'cli/ai/sessions/store';
import { runCommand as runAiCommand } from 'cli/commands/ai';
import { chooseSessionForAction } from 'cli/commands/ai/sessions/helpers';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

export async function runCommand(
	sessionIdOrPrefix?: string,
	options: { noSessionPersistence?: boolean } = {}
): Promise< void > {
	let resolvedSessionIdOrPrefix = sessionIdOrPrefix?.trim();

	if ( ! resolvedSessionIdOrPrefix ) {
		const selectedSession = await chooseSessionForAction(
			__( 'Select a session to resume:' ),
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

	const session = await loadAiSession( resolvedSessionIdOrPrefix );
	await runAiCommand( {
		adapter: new InteractiveAdapter(),
		resumeSession: session,
		noSessionPersistence: options.noSessionPersistence === true,
	} );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'resume [id]',
		describe: __( 'Resume an AI session (id, prefix, "latest", or picker)' ),
		builder: ( resumeYargs ) => {
			return resumeYargs.positional( 'id', {
				type: 'string',
				describe: __( 'Session id, id prefix, or "latest"' ),
			} );
		},
		handler: async ( argv ) => {
			try {
				const noSessionPersistence =
					( argv as { sessionPersistence?: boolean } ).sessionPersistence === false;
				await runCommand( typeof argv.id === 'string' ? argv.id : undefined, {
					noSessionPersistence,
				} );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to resume AI session' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
