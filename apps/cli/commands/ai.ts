import { __ } from '@wordpress/i18n';
import { AI_MODELS, DEFAULT_MODEL, startAiAgent, type AiModelId } from 'cli/ai/agent';
import {
	getAvailableAiProviders,
	isAiProviderReady,
	prepareAiProvider,
	resolveAiEnvironment,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
	saveSelectedAiProvider,
} from 'cli/ai/auth';
import { AI_PROVIDERS, type AiProviderId } from 'cli/ai/providers';
import {
	AI_CHAT_BROWSER_COMMAND,
	AI_CHAT_EXIT_COMMAND,
	AI_CHAT_LOGIN_COMMAND,
	AI_CHAT_LOGOUT_COMMAND,
	AI_CHAT_MODEL_COMMAND,
	AI_CHAT_PROVIDER_COMMAND,
} from 'cli/ai/slash-commands';
import { AiChatUI } from 'cli/ai/ui';
import { runCommand as runLoginCommand } from 'cli/commands/auth/login';
import { runCommand as runLogoutCommand } from 'cli/commands/auth/logout';
import { getAnthropicApiKey, getAuthToken } from 'cli/lib/appdata';
import { Logger, LoggerError, setProgressCallback } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

function isPromptAbortError( error: unknown ): boolean {
	return (
		error instanceof Error &&
		[ 'AbortPromptError', 'CancelPromptError', 'ExitPromptError' ].includes( error.name )
	);
}

export async function runCommand(): Promise< void > {
	const ui = new AiChatUI();
	let currentProvider: AiProviderId = await resolveInitialAiProvider();
	ui.currentProvider = currentProvider;
	setProgressCallback( ( message ) => ui.setLoaderMessage( message ) );
	ui.start();
	ui.showWelcome();

	let sessionId: string | undefined;
	let currentModel: AiModelId = DEFAULT_MODEL;

	async function prepareProviderSelection( provider: AiProviderId ): Promise< void > {
		ui.stop();
		try {
			await prepareAiProvider( provider );
		} finally {
			ui.start();
		}
	}

	async function switchProvider( provider: AiProviderId, announce = true ): Promise< void > {
		currentProvider = provider;
		ui.currentProvider = currentProvider;
		sessionId = undefined;
		await saveSelectedAiProvider( currentProvider );
		if ( announce ) {
			ui.showInfo( `Switched to ${ AI_PROVIDERS[ currentProvider ] }` );
		}
	}

	async function maybeAutoSwitchProvider(): Promise< void > {
		const fallbackProvider = await resolveUnavailableAiProvider( currentProvider );
		if ( ! fallbackProvider || fallbackProvider === currentProvider ) {
			return;
		}

		const previousProvider = currentProvider;
		await switchProvider( fallbackProvider, false );
		ui.showInfo(
			`${ AI_PROVIDERS[ previousProvider ] } is no longer available. Switched to ${ AI_PROVIDERS[ currentProvider ] }.`
		);
	}

	if ( currentProvider === 'wpcom' ) {
		try {
			const token = await getAuthToken();
			ui.showInfo( `Logged in as ${ token.displayName } (${ token.email })` );
		} catch {
			ui.showInfo( 'WordPress.com provider selected. Use /login to authenticate.' );
		}
	}

	if ( currentProvider === 'anthropic-api-key' && ! ( await getAnthropicApiKey() ) ) {
		ui.showInfo( 'No Anthropic API key saved. Use /provider to enter one.' );
	}

	async function runAgentTurn( prompt: string ): Promise< void > {
		const env = await resolveAiEnvironment( currentProvider );
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
			env,
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
				if ( await isAiProviderReady( 'wpcom' ) ) {
					const token = await getAuthToken();
					ui.showInfo( `Logged in as ${ token.displayName } (${ token.email })` );
				} else {
					ui.showInfo( 'Login failed or canceled.' );
				}
				continue;
			}

			if ( trimmedPrompt === AI_CHAT_LOGOUT_COMMAND ) {
				ui.stop();
				await runLogoutCommand();
				ui.start();
				ui.showInfo( 'Logged out of WordPress.com.' );
				await maybeAutoSwitchProvider();
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

			if ( trimmedPrompt === AI_CHAT_PROVIDER_COMMAND ) {
				const availableProviders = await getAvailableAiProviders();
				const providerOptions = availableProviders.map( ( id ) => ( {
					label: id === currentProvider ? `${ AI_PROVIDERS[ id ] } (current)` : AI_PROVIDERS[ id ],
					description: id,
				} ) );
				const answer = await ui.askUser( [
					{ question: 'Select an AI provider', options: providerOptions },
				] );
				const selectedLabel = Object.values( answer )[ 0 ] as string;
				const newProvider = availableProviders.find( ( id ) =>
					selectedLabel.startsWith( AI_PROVIDERS[ id ] )
				);
				if ( newProvider && newProvider !== currentProvider ) {
					try {
						await prepareProviderSelection( newProvider );
						await switchProvider( newProvider );
					} catch ( error ) {
						if ( isPromptAbortError( error ) ) {
							ui.showInfo( `Provider setup canceled. Kept ${ AI_PROVIDERS[ currentProvider ] }.` );
							continue;
						}
						if ( error instanceof LoggerError ) {
							ui.showError( error.message );
							continue;
						}
						throw error;
					}
				}
				continue;
			}

			await maybeAutoSwitchProvider();

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
