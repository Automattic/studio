import { resolveActiveSiteFromEvents } from '@studio/common/ai/sessions/active-site';
import { listAiSessions, loadAiSession } from '@studio/common/ai/sessions/store';
import { __ } from '@wordpress/i18n';
import { JsonAdapter } from 'cli/ai/output-adapter';
import { getAiSessionsRootDirectory } from 'cli/ai/sessions/paths';
import { AiChatUI } from 'cli/ai/ui';
import { runCommand as runAiCommand } from 'cli/commands/ai';
import { chooseSessionForAction } from 'cli/commands/ai/sessions/helpers';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import type { AiOutputAdapter } from 'cli/ai/output-adapter';

export async function runCommand(
	sessionIdOrPrefix?: string,
	options: {
		noSessionPersistence?: boolean;
		message?: string;
		displayMessage?: string;
		json?: boolean;
	} = {}
): Promise< void > {
	let resolvedSessionIdOrPrefix = sessionIdOrPrefix?.trim();

	if ( ! resolvedSessionIdOrPrefix ) {
		const selectedSession = await chooseSessionForAction(
			__( 'Select a session to resume:' ),
			__( 'No code sessions found' )
		);
		if ( ! selectedSession ) {
			return;
		}

		resolvedSessionIdOrPrefix = selectedSession.id;
	}

	if ( resolvedSessionIdOrPrefix.toLowerCase() === 'latest' ) {
		const sessions = await listAiSessions( getAiSessionsRootDirectory() );
		if ( sessions.length === 0 ) {
			throw new Error( __( 'No code sessions found' ) );
		}

		resolvedSessionIdOrPrefix = sessions[ 0 ].id;
	}

	const session = await loadAiSession( getAiSessionsRootDirectory(), resolvedSessionIdOrPrefix );
	const adapter: AiOutputAdapter = options.json ? new JsonAdapter() : new AiChatUI();

	// JSON-mode resume has no replay loop (that only runs for AiChatUI), so the
	// active site would stay null and the agent would fall back to local tools
	// even if the session was flipped to live. Hydrate it explicitly from the
	// event log instead.
	const resolvedSite =
		adapter instanceof JsonAdapter ? resolveActiveSiteFromEvents( session.events ) : undefined;

	await runAiCommand( {
		adapter,
		resumeSession: session,
		noSessionPersistence: options.noSessionPersistence === true,
		initialMessage: options.message,
		initialDisplayMessage: options.displayMessage,
		activeSite: resolvedSite,
	} );
}

const logger = new Logger< string >();

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'resume [id] [message]',
		describe: __( 'Resume a code session (id, prefix, "latest", or picker)' ),
		builder: ( resumeYargs ) => {
			return resumeYargs
				.positional( 'id', {
					type: 'string',
					describe: __( 'Session id, id prefix, or "latest"' ),
				} )
				.positional( 'message', {
					type: 'string',
					describe: __( 'Message to send on resume (required with --json)' ),
				} )
				.option( 'json', {
					type: 'boolean',
					default: false,
					description: __( 'Output events as NDJSON to stdout (headless mode)' ),
				} )
				.option( 'display-message', {
					type: 'string',
					hidden: true,
					description: __( 'Message to persist and display in the session transcript' ),
				} )
				.check( ( argv ) => {
					if ( argv.json && ! argv.message ) {
						throw new Error( __( '--json requires a message argument' ) );
					}
					return true;
				} );
		},
		handler: async ( argv ) => {
			try {
				const typedArgv = argv as {
					id?: string;
					message?: string;
					displayMessage?: string;
					json?: boolean;
					sessionPersistence?: boolean;
				};
				const noSessionPersistence = typedArgv.sessionPersistence === false;
				await runCommand( typedArgv.id, {
					noSessionPersistence,
					message: typedArgv.message,
					displayMessage: typedArgv.displayMessage,
					json: typedArgv.json,
				} );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to resume code session' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
