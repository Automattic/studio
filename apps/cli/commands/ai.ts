import { password } from '@inquirer/prompts';
import { AiCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import { startAiAgent } from 'cli/ai/agent';
import { enablePm2KeepAlive, setToolProgressHandler } from 'cli/ai/tools';
import { AiChatUI } from 'cli/ai/ui';
import { getAnthropicApiKey, saveAnthropicApiKey } from 'cli/lib/appdata';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

async function resolveApiKey(): Promise< string > {
	const savedKey = await getAnthropicApiKey();
	if ( savedKey ) {
		return savedKey;
	}

	const apiKey = await password( {
		message: __( 'Enter your Anthropic API key (will be saved for future use):' ),
		mask: '*',
		validate: ( value ) => {
			if ( ! value.trim() ) {
				return __( 'API key is required' );
			}
			return true;
		},
	} );

	await saveAnthropicApiKey( apiKey );
	return apiKey;
}

export async function runCommand( options: { maxTurns?: number } ): Promise< void > {
	const apiKey = await resolveApiKey();

	const ui = new AiChatUI();
	setToolProgressHandler( ( message ) => ui.setLoaderMessage( message ) );
	enablePm2KeepAlive();
	ui.start();

	let sessionId: string | undefined;

	try {
		while ( true ) {
			const prompt = await ui.waitForInput();

			ui.addUserMessage( prompt );
			ui.beginAgentTurn();

			const agentQuery = startAiAgent( {
				prompt,
				apiKey,
				maxTurns: options.maxTurns,
				resume: sessionId,
				onAskUser: ( questions ) => ui.askUser( questions ),
			} );

			// Escape key interrupts the current agent turn
			ui.onInterrupt = () => {
				void agentQuery.interrupt();
			};

			for await ( const message of agentQuery ) {
				const result = ui.handleMessage( message );
				if ( result ) {
					sessionId = result.sessionId;
				}
			}

			ui.endAgentTurn();
		}
	} finally {
		ui.stop();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'ai',
		describe: __( 'AI-powered WordPress assistant' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'max-turns', {
					type: 'number',
					describe: __( 'Maximum conversation turns' ),
					default: 50,
				} )
				.option( 'path', {
					hidden: true,
				} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( {
					maxTurns: argv.maxTurns,
				} );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'AI agent failed' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
