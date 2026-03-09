import { password } from '@inquirer/prompts';
import { __ } from '@wordpress/i18n';
import { startAiAgent } from 'cli/ai/agent';
import { AiChatUI } from 'cli/ai/ui';
import { getAnthropicApiKey, saveAnthropicApiKey } from 'cli/lib/appdata';
import { setKeepAlive } from 'cli/lib/pm2-manager';
import { Logger, LoggerError, setProgressCallback } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

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

export async function runCommand(): Promise< void > {
	const apiKey = await resolveApiKey();

	const ui = new AiChatUI();
	setProgressCallback( ( message ) => ui.setLoaderMessage( message ) );
	setKeepAlive( true );
	ui.start();
	ui.showWelcome();

	let sessionId: string | undefined;

	async function runAgentTurn( prompt: string ): Promise< void > {
		ui.beginAgentTurn();

		// Prepend active site context to the prompt
		let enrichedPrompt = prompt;
		const site = ui.activeSite;
		if ( site ) {
			enrichedPrompt = `[Active site: "${ site.name }" at ${ site.path }${
				site.running ? ' (running)' : ' (stopped)'
			}]\n\n${ prompt }`;
		}

		const agentQuery = startAiAgent( {
			prompt: enrichedPrompt,
			apiKey,
			resume: sessionId,
			onAskUser: ( questions ) => ui.askUser( questions ),
		} );

		ui.onInterrupt = () => {
			void agentQuery.interrupt();
		};

		let maxTurnsResult: { numTurns: number; costUsd: number } | undefined;

		for await ( const message of agentQuery ) {
			const result = ui.handleMessage( message );
			if ( result ) {
				sessionId = result.sessionId;
				if ( 'maxTurnsReached' in result && result.maxTurnsReached ) {
					maxTurnsResult = {
						numTurns: result.numTurns,
						costUsd: result.costUsd,
					};
				}
			}
		}

		ui.endAgentTurn();

		if ( maxTurnsResult ) {
			ui.showInfo(
				`Used ${ maxTurnsResult.numTurns } turns · $${ maxTurnsResult.costUsd.toFixed( 4 ) }`
			);
			const answer = await ui.askUser( [
				{
					question: 'Reached the turn limit. Continue?',
					options: [
						{ label: 'Yes', description: 'Resume where the agent left off' },
						{ label: 'No', description: 'Stop here' },
					],
				},
			] );
			const choice = Object.values( answer )[ 0 ]?.toLowerCase();
			if ( choice === 'yes' ) {
				ui.addUserMessage( 'Continue' );
				await runAgentTurn( 'Continue from where you left off.' );
			}
		}
	}

	try {
		while ( true ) {
			const prompt = await ui.waitForInput();
			ui.addUserMessage( prompt );
			await runAgentTurn( prompt );
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
			return yargs.option( 'path', {
				hidden: true,
			} );
		},
		handler: async () => {
			try {
				await runCommand();
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
