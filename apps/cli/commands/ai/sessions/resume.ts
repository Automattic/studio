import fs from 'fs/promises';
import { validateStudioChatFiles } from '@studio/common/ai/chat-files';
import { validateStudioChatImages } from '@studio/common/ai/chat-images';
import { resolveActiveSiteFromEntries } from '@studio/common/ai/sessions/active-site';
import { listAiSessions, loadAiSession } from '@studio/common/ai/sessions/store';
import { __ } from '@wordpress/i18n';
import { JsonAdapter } from 'cli/ai/output-adapter';
import { getAiSessionsRootDirectory } from 'cli/ai/sessions/paths';
import { AiChatUI } from 'cli/ai/ui';
import { runCommand as runAiCommand } from 'cli/commands/ai';
import { chooseSessionForAction } from 'cli/commands/ai/sessions/helpers';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import type { StudioAiSessionInputPayload } from '@studio/common/ai/chat-images';
import type { AiOutputAdapter } from 'cli/ai/output-adapter';

async function readInputPayload( path: string ): Promise< StudioAiSessionInputPayload > {
	const parsed = JSON.parse( await fs.readFile( path, 'utf8' ) ) as StudioAiSessionInputPayload;
	if ( ! parsed || typeof parsed.prompt !== 'string' || ! parsed.prompt.trim() ) {
		throw new Error( __( 'Invalid AI session input payload.' ) );
	}
	return {
		prompt: parsed.prompt,
		displayMessage: parsed.displayMessage,
		images: validateStudioChatImages( parsed.images ),
		files: validateStudioChatFiles( parsed.files ),
	};
}

export async function runCommand(
	sessionIdOrPrefix?: string,
	options: {
		message?: string;
		displayMessage?: string;
		inputPayloadPath?: string;
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
	const inputPayload = options.inputPayloadPath
		? await readInputPayload( options.inputPayloadPath )
		: undefined;

	// JSON-mode resume has no replay loop (that only runs for AiChatUI), so the
	// active site would stay null and the agent would fall back to local tools
	// even if the session was flipped to live. Hydrate it explicitly from the
	// event log instead.
	const resolvedSite =
		adapter instanceof JsonAdapter ? resolveActiveSiteFromEntries( session.entries ) : undefined;

	await runAiCommand( {
		adapter,
		resumeSession: session,
		initialMessage: inputPayload?.prompt ?? options.message,
		initialDisplayMessage: inputPayload?.displayMessage ?? options.displayMessage,
		initialImages: inputPayload?.images,
		initialFiles: inputPayload?.files,
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
				.option( 'input-payload', {
					type: 'string',
					hidden: true,
					description: __( 'Path to a JSON input payload for the session turn' ),
				} )
				.check( ( argv ) => {
					if ( argv.json && ! argv.message && ! argv.inputPayload ) {
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
					inputPayload?: string;
					json?: boolean;
				};
				await runCommand( typedArgv.id, {
					message: typedArgv.message,
					displayMessage: typedArgv.displayMessage,
					inputPayloadPath: typedArgv.inputPayload,
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
