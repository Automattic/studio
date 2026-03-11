import { execFileSync } from 'child_process';
import { password } from '@inquirer/prompts';
import { __ } from '@wordpress/i18n';
import { AI_MODELS, DEFAULT_MODEL, startAiAgent, type AiModelId } from 'cli/ai/agent';
import {
	AI_CHAT_BROWSER_COMMAND,
	AI_CHAT_EXIT_COMMAND,
	AI_CHAT_LOGIN_COMMAND,
	AI_CHAT_LOGOUT_COMMAND,
	AI_CHAT_MODEL_COMMAND,
} from 'cli/ai/slash-commands';
import { AiChatUI } from 'cli/ai/ui';
import { runCommand as runLoginCommand } from 'cli/commands/auth/login';
import { runCommand as runLogoutCommand } from 'cli/commands/auth/logout';
import { getAnthropicApiKey, getAuthToken, saveAnthropicApiKey } from 'cli/lib/appdata';
import { Logger, LoggerError, setProgressCallback } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

function isClaudeCodeAuthenticated(): boolean {
	try {
		const output = execFileSync( 'claude', [ 'auth', 'status' ], {
			encoding: 'utf8',
			timeout: 5000,
			stdio: [ 'pipe', 'pipe', 'pipe' ],
		} );
		return (
			output.toLowerCase().includes( 'authenticated' ) || ! output.toLowerCase().includes( 'not' )
		);
	} catch {
		return false;
	}
}

async function resolveApiKey(): Promise< string | undefined > {
	// Check for saved API key first
	const savedKey = await getAnthropicApiKey();
	if ( savedKey ) {
		return savedKey;
	}

	// If Claude Code is authenticated, use its auth
	if ( isClaudeCodeAuthenticated() ) {
		return undefined;
	}

	// Fall back to prompting for an API key
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
	ui.start();
	ui.showWelcome();

	try {
		const token = await getAuthToken();
		ui.showInfo( `Logged in as ${ token.displayName } (${ token.email })` );
	} catch {
		ui.showInfo( 'Not logged in to WordPress.com. Use /login to authenticate.' );
	}

	let sessionId: string | undefined;
	let currentModel: AiModelId = DEFAULT_MODEL;

	async function runAgentTurn( prompt: string ): Promise< void > {
		ui.beginAgentTurn();

		// Prepend active site context to the prompt
		let enrichedPrompt = prompt;
		const site = ui.activeSite;
		if ( site?.remote && site?.url ) {
			enrichedPrompt = `[Active site: "${ site.name }" at ${ site.url } (WordPress.com)]\n\n${ prompt }`;
		} else if ( site ) {
			enrichedPrompt = `[Active site: "${ site.name }" at ${ site.path }${
				site.running ? ' (running)' : ' (stopped)'
			}]\n\n${ prompt }`;
		}

		const agentQuery = startAiAgent( {
			prompt: enrichedPrompt,
			apiKey,
			model: currentModel,
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
			const trimmedPrompt = prompt.trim();

			if ( trimmedPrompt === AI_CHAT_EXIT_COMMAND ) {
				break;
			}

			if ( trimmedPrompt === AI_CHAT_BROWSER_COMMAND ) {
				const opened = await ui.openActiveSiteInBrowser();
				if ( ! opened ) {
					ui.showInfo( 'No site selected. Use ↓ to select a site first.' );
				}
				continue;
			}

			if ( trimmedPrompt === AI_CHAT_LOGIN_COMMAND ) {
				ui.stop();
				await runLoginCommand();
				ui.start();
				try {
					const token = await getAuthToken();
					ui.showInfo( `Logged in as ${ token.displayName } (${ token.email })` );
				} catch {
					ui.showInfo( 'Login failed or canceled.' );
				}
				continue;
			}

			if ( trimmedPrompt === AI_CHAT_LOGOUT_COMMAND ) {
				ui.stop();
				await runLogoutCommand();
				ui.start();
				ui.showInfo( 'Logged out of WordPress.com.' );
				continue;
			}

			if ( trimmedPrompt === AI_CHAT_MODEL_COMMAND ) {
				const modelOptions = ( Object.entries( AI_MODELS ) as [ AiModelId, string ][] ).map(
					( [ id, label ] ) => ( {
						label: id === currentModel ? `${ label } (current)` : label,
						description: id,
					} )
				);
				const answer = await ui.askUser( [
					{ question: 'Select a model', options: modelOptions },
				] );
				const selectedId = Object.values( answer )[ 0 ] as string;
				const newModel = ( Object.entries( AI_MODELS ) as [ AiModelId, string ][] ).find(
					( [ , label ] ) => selectedId.startsWith( label )
				);
				if ( newModel && newModel[ 0 ] !== currentModel ) {
					currentModel = newModel[ 0 ];
					ui.currentModel = currentModel;
					ui.showInfo( `Switched to ${ AI_MODELS[ currentModel ] }` );
				}
				continue;
			}

			ui.addUserMessage( prompt );
			await runAgentTurn( prompt );
		}
	} finally {
		ui.stop();
		process.exit( 0 );
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
