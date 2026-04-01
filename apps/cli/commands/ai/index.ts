import { readAuthToken } from '@studio/common/lib/shared-config';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	AI_MODELS,
	DEFAULT_MODEL,
	startAiAgent,
	type AiModelId,
	type AskUserQuestion,
} from 'cli/ai/agent';
import {
	getAvailableAiProviders,
	isAiProviderReady,
	prepareAiProvider,
	resolveAiEnvironment,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
	saveSelectedAiProvider,
} from 'cli/ai/auth';
import { type AiOutputAdapter, InteractiveAdapter, JsonAdapter } from 'cli/ai/output-adapter';
import { AI_PROVIDERS, type AiProviderId } from 'cli/ai/providers';
import { resolveResumeSessionContext } from 'cli/ai/sessions/context';
import { AiSessionRecorder } from 'cli/ai/sessions/recorder';
import { replaySessionHistory } from 'cli/ai/sessions/replay';
import { type LoadedAiSession, type TurnStatus } from 'cli/ai/sessions/types';
import {
	AI_CHAT_API_KEY_COMMAND,
	AI_CHAT_BROWSER_COMMAND,
	AI_CHAT_EXIT_COMMAND,
	AI_CHAT_LOGIN_COMMAND,
	AI_CHAT_LOGOUT_COMMAND,
	AI_CHAT_MODEL_COMMAND,
	AI_CHAT_PROVIDER_COMMAND,
} from 'cli/ai/slash-commands';
import { runCommand as runLoginCommand } from 'cli/commands/auth/login';
import { runCommand as runLogoutCommand } from 'cli/commands/auth/logout';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { Logger, LoggerError, setProgressCallback } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

function isPromptAbortError( error: unknown ): boolean {
	return (
		error instanceof Error &&
		[ 'AbortPromptError', 'CancelPromptError', 'ExitPromptError' ].includes( error.name )
	);
}

function getErrorMessage( error: unknown ): string {
	if ( error instanceof Error ) {
		return error.message;
	}

	return String( error );
}

export async function runCommand( options: {
	adapter: AiOutputAdapter;
	initialMessage?: string;
	resumeSession?: LoadedAiSession;
	noSessionPersistence?: boolean;
} ): Promise< void > {
	const ui = options.adapter;
	const isJsonMode = ui instanceof JsonAdapter;
	const resumeContext = resolveResumeSessionContext( options.resumeSession );
	let currentProvider: AiProviderId =
		resumeContext.provider ?? ( await resolveInitialAiProvider() );
	let currentModel: AiModelId = resumeContext.model ?? DEFAULT_MODEL;
	ui.currentProvider = currentProvider;
	ui.currentModel = currentModel;
	ui.start();
	ui.showWelcome();

	let sessionRecorder: AiSessionRecorder | undefined;
	let didDisableSessionPersistence = options.noSessionPersistence === true;
	let sessionId: string | undefined = resumeContext.sessionId;
	let persistQueue: Promise< void > = Promise.resolve();

	if ( options.noSessionPersistence ) {
		ui.showInfo( __( 'Session persistence disabled (--no-session-persistence).' ) );
	}

	const ensureSessionRecorder = async (): Promise< AiSessionRecorder | undefined > => {
		if ( didDisableSessionPersistence ) {
			return undefined;
		}
		if ( sessionRecorder ) {
			return sessionRecorder;
		}

		try {
			if ( options.resumeSession ) {
				sessionRecorder = await AiSessionRecorder.open( {
					sessionId: options.resumeSession.summary.id,
					filePath: options.resumeSession.summary.filePath,
					linkedAgentSessionIds: options.resumeSession.summary.linkedAgentSessionIds,
				} );
			} else {
				sessionRecorder = await AiSessionRecorder.create();
			}
		} catch ( error ) {
			didDisableSessionPersistence = true;
			ui.showError(
				sprintf(
					/* translators: %s: error message */
					__( 'Session persistence disabled: %s' ),
					getErrorMessage( error )
				)
			);
		}

		return sessionRecorder;
	};

	const persist = ( callback: ( recorder: AiSessionRecorder ) => Promise< void > ) => {
		persistQueue = persistQueue.then( async () => {
			const recorder = await ensureSessionRecorder();
			if ( ! recorder ) {
				return;
			}

			try {
				await callback( recorder );
			} catch ( error ) {
				sessionRecorder = undefined;
				if ( ! didDisableSessionPersistence ) {
					didDisableSessionPersistence = true;
					ui.showError(
						sprintf(
							/* translators: %s: error message */
							__( 'Session persistence disabled: %s' ),
							getErrorMessage( error )
						)
					);
				}
			}
		} );

		return persistQueue;
	};

	async function persistSessionContext(): Promise< void > {
		await persist( ( recorder ) =>
			recorder.recordSessionContext( {
				provider: currentProvider,
				model: currentModel,
			} )
		);
	}

	setProgressCallback( ( message ) => {
		const timestamp = new Date().toISOString();
		ui.setLoaderMessage( message );
		void persist( ( recorder ) => recorder.recordToolProgress( message, timestamp ) );
	} );

	ui.onSiteSelected = ( site ) => {
		void persist( ( recorder ) =>
			recorder.recordSiteSelected( {
				name: site.name,
				path: site.path,
				remote: site.remote,
				url: site.url,
			} )
		);
	};

	if ( options.resumeSession ) {
		ui.showInfo(
			sprintf(
				/* translators: %s: session ID */
				__( 'Resuming session %s' ),
				options.resumeSession.summary.id
			)
		);
		replaySessionHistory( ui, options.resumeSession.events );
		if ( ! sessionId ) {
			ui.showInfo( __( 'No linked Claude session was found. Continuing from transcript only.' ) );
		}
	}

	async function prepareProviderSelection(
		provider: AiProviderId,
		options?: { force?: boolean }
	): Promise< void > {
		ui.stop();
		try {
			await prepareAiProvider( provider, options );
		} finally {
			ui.start();
		}
	}

	async function switchProvider( provider: AiProviderId, announce = true ): Promise< void > {
		currentProvider = provider;
		ui.currentProvider = currentProvider;
		sessionId = undefined;
		await saveSelectedAiProvider( currentProvider );
		await persistSessionContext();
		if ( announce ) {
			ui.showInfo(
				sprintf(
					/* translators: %s: provider name */
					__( 'Switched to %s' ),
					AI_PROVIDERS[ currentProvider ]
				)
			);
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
			sprintf(
				/* translators: 1: previous provider name, 2: new provider name */
				__( '%1$s is no longer available. Switched to %2$s.' ),
				AI_PROVIDERS[ previousProvider ],
				AI_PROVIDERS[ currentProvider ]
			)
		);
	}

	function handleAgentTurnError( error: unknown ): void {
		sessionId = undefined;

		if ( error instanceof LoggerError ) {
			ui.showError( error.message );
		} else if ( error instanceof Error ) {
			ui.showError( error.message );
		} else {
			ui.showError( __( 'AI agent failed' ) );
		}

		if ( currentProvider === 'anthropic-api-key' ) {
			ui.showInfo( __( 'Use /api-key to update the Anthropic API key.' ) );
		}
	}

	if ( currentProvider === 'wpcom' ) {
		const token = await readAuthToken();
		if ( token ) {
			ui.setStatusMessage(
				sprintf(
					/* translators: %s: user display name */
					__( 'Logged in as %s' ),
					token.displayName
				)
			);
		} else {
			ui.setStatusMessage( __( 'Use /login to authenticate to WordPress.com' ) );
		}
	}

	const { anthropicApiKey } = await readCliConfig();
	if ( currentProvider === 'anthropic-api-key' && ! anthropicApiKey ) {
		ui.showInfo( __( 'No Anthropic API key saved. Use /provider to enter one.' ) );
	}

	async function askUserAndPersistAnswers(
		questions: AskUserQuestion[]
	): Promise< Record< string, string > > {
		for ( const question of questions ) {
			await persist( ( recorder ) =>
				recorder.recordAgentQuestion( {
					question: question.question,
					options: question.options.map( ( option ) => ( {
						label: option.label,
						description: option.description,
					} ) ),
				} )
			);
		}

		const answers = await ui.askUser( questions );
		for ( const question of questions ) {
			const answer = answers[ question.question ];
			if ( typeof answer !== 'string' || ! answer.trim() ) {
				continue;
			}

			await persist( ( recorder ) =>
				recorder.recordUserMessage( {
					text: answer,
					source: 'ask_user',
					sitePath: ui.activeSite?.path,
				} )
			);
		}

		return answers;
	}

	async function runAgentTurn(
		prompt: string
	): Promise< { status: TurnStatus; usage?: { numTurns: number; costUsd: number } } > {
		const env = await resolveAiEnvironment( currentProvider );
		ui.beginAgentTurn();

		// Prepend active site context to the prompt.
		// Remote (WordPress.com) sites only have a URL; local sites have a filesystem path and running state.
		let enrichedPrompt = prompt;
		const site = ui.activeSite;
		if ( site?.remote && site?.url ) {
			enrichedPrompt = `[Active site: "${ site.name }" at ${ site.url } (WordPress.com)]\n\n${ prompt }`;
		} else if ( site ) {
			enrichedPrompt = `[Active site: "${ site.name }" at ${ site.path }${
				site.running ? ' (running)' : ' (stopped)'
			}]\n\n${ prompt }`;
		}

		await persistSessionContext();

		await persist( ( recorder ) =>
			recorder.recordUserMessage( {
				text: prompt,
				source: 'prompt',
				sitePath: site?.path,
			} )
		);

		const agentQuery = startAiAgent( {
			prompt: enrichedPrompt,
			env,
			model: currentModel,
			resume: sessionId,
			autoApprove: isJsonMode,
			onAskUser: ( questions ) => askUserAndPersistAnswers( questions ),
		} );

		ui.onInterrupt = () => {
			void agentQuery.interrupt();
		};

		let maxTurnsResult: { numTurns: number } | undefined;
		let turnStatus: TurnStatus = 'interrupted';

		try {
			for await ( const message of agentQuery ) {
				const timestamp = new Date().toISOString();
				const result = ui.handleMessage( message );
				await persist( ( recorder ) => recorder.recordSdkMessage( message, timestamp ) );
				if ( result ) {
					sessionId = result.sessionId;
					await persist( ( recorder ) => recorder.recordAgentSessionId( result.sessionId ) );

					if ( 'maxTurnsReached' in result && result.maxTurnsReached ) {
						maxTurnsResult = {
							numTurns: result.numTurns,
						};
						turnStatus = 'max_turns';
					} else {
						turnStatus = result.success ? 'success' : 'error';
					}
				}
			}
		} catch ( error ) {
			turnStatus = 'error';
			throw error;
		} finally {
			await persist( ( recorder ) => recorder.recordTurnClosed( turnStatus ) );
			ui.endAgentTurn();
		}

		if ( maxTurnsResult ) {
			ui.showInfo(
				sprintf(
					/* translators: %d: number of turns used */
					_n( 'Used %d turn', 'Used %d turns', maxTurnsResult.numTurns ),
					maxTurnsResult.numTurns
				)
			);
			const answer = await ui.askUser( [
				{
					question: __( 'Reached the turn limit. Continue?' ),
					options: [
						{ label: 'Yes', description: __( 'Resume where the agent left off' ) },
						{ label: 'No', description: __( 'Stop here' ) },
					],
				},
			] );
			const choice = Object.values( answer )[ 0 ]?.toLowerCase();
			if ( choice === 'yes' ) {
				ui.addUserMessage( 'Continue' );
				return runAgentTurn( 'Continue from where you left off.' );
			}
		}

		return {
			status: turnStatus,
			usage: maxTurnsResult,
		};
	}

	// JSON mode: single turn, then exit
	if ( options.initialMessage ) {
		let exitCode = 0;
		try {
			ui.addUserMessage( options.initialMessage );
			const result = await runAgentTurn( options.initialMessage );
			if ( isJsonMode ) {
				const jsonStatus = result.status === 'interrupted' ? 'error' : result.status;
				( ui as JsonAdapter ).emitTurnCompleted( jsonStatus, result.usage );
			}
		} catch ( error ) {
			exitCode = 1;
			handleAgentTurnError( error );
			if ( isJsonMode ) {
				( ui as JsonAdapter ).emitTurnCompleted( 'error' );
			}
		} finally {
			await persistQueue;
			ui.stop();
			process.exit( exitCode );
		}
		return;
	}

	// Interactive mode: input loop
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
					ui.showInfo( __( 'No site selected. Use ↓ to select a site first.' ) );
				}
				continue;
			}

			if ( trimmedPrompt === AI_CHAT_API_KEY_COMMAND ) {
				try {
					await prepareProviderSelection( 'anthropic-api-key', { force: true } );
					ui.showInfo( __( 'Anthropic API key updated.' ) );
				} catch ( error ) {
					if ( isPromptAbortError( error ) ) {
						ui.showInfo( __( 'API key update canceled.' ) );
						continue;
					}
					if ( error instanceof LoggerError ) {
						ui.showError( error.message );
						continue;
					}
					throw error;
				}
				continue;
			}

			if ( trimmedPrompt === AI_CHAT_LOGIN_COMMAND ) {
				ui.stop();
				await runLoginCommand();
				ui.start();
				if ( await isAiProviderReady( 'wpcom' ) ) {
					const token = await readAuthToken();
					if ( token ) {
						ui.showInfo(
							sprintf(
								/* translators: 1: display name, 2: email */
								__( 'Logged in as %1$s (%2$s)' ),
								token.displayName,
								token.email
							)
						);
						ui.setStatusMessage(
							sprintf(
								/* translators: %s: display name */
								__( 'Logged in as %s' ),
								token.displayName
							)
						);
					}
				} else {
					ui.setStatusMessage( __( 'Login failed or canceled' ) );
				}
				continue;
			}

			if ( trimmedPrompt === AI_CHAT_LOGOUT_COMMAND ) {
				ui.stop();
				await runLogoutCommand();
				ui.start();
				ui.setStatusMessage( __( 'Logged out of WordPress.com' ) );
				await maybeAutoSwitchProvider();
				continue;
			}

			if ( trimmedPrompt === AI_CHAT_MODEL_COMMAND ) {
				const modelOptions = ( Object.entries( AI_MODELS ) as [ AiModelId, string ][] ).map(
					( [ id, label ] ) => ( {
						label:
							id === currentModel
								? sprintf(
										/* translators: %s: model name */
										__( '%s (current)' ),
										label
								  )
								: label,
						description: id,
					} )
				);
				const answer = await ui.askUser( [
					{ question: __( 'Select a model' ), options: modelOptions },
				] );
				const selectedId = Object.values( answer )[ 0 ] as string;
				const newModel = ( Object.entries( AI_MODELS ) as [ AiModelId, string ][] ).find(
					( [ , label ] ) => selectedId.startsWith( label )
				);
				if ( newModel && newModel[ 0 ] !== currentModel ) {
					currentModel = newModel[ 0 ];
					ui.currentModel = currentModel;
					ui.showInfo(
						sprintf(
							/* translators: %s: model name */
							__( 'Switched to %s' ),
							AI_MODELS[ currentModel ]
						)
					);
					await persistSessionContext();
				}
				continue;
			}

			if ( trimmedPrompt === AI_CHAT_PROVIDER_COMMAND ) {
				const availableProviders = await getAvailableAiProviders();
				const providerOptions = availableProviders.map( ( id ) => ( {
					label:
						id === currentProvider
							? sprintf(
									/* translators: %s: provider name */
									__( '%s (current)' ),
									AI_PROVIDERS[ id ]
							  )
							: AI_PROVIDERS[ id ],
					description: id,
				} ) );
				const answer = await ui.askUser( [
					{ question: __( 'Select an AI provider' ), options: providerOptions },
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
							ui.showInfo(
								sprintf(
									/* translators: %s: provider name */
									__( 'Provider setup canceled. Kept %s.' ),
									AI_PROVIDERS[ currentProvider ]
								)
							);
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
			try {
				await runAgentTurn( prompt );
			} catch ( error ) {
				handleAgentTurnError( error );
			}
		}
	} finally {
		await persistQueue;
		ui.stop();
		process.exit( 0 );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: '$0 [message]',
		describe: __( 'AI-powered WordPress assistant' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'message', {
					type: 'string',
					description: __( 'Initial message to send to the AI agent' ),
				} )
				.option( 'path', {
					hidden: true,
				} )
				.option( 'json', {
					type: 'boolean',
					default: false,
					description: __( 'Output events as NDJSON to stdout (headless mode)' ),
				} )
				.option( 'session-persistence', {
					type: 'boolean',
					default: true,
					description: __( 'Record this AI chat session to disk' ),
				} )
				.check( ( argv ) => {
					if ( argv.json && ! argv.message ) {
						throw new Error( __( '--json requires an initial message argument' ) );
					}
					return true;
				} );
		},
		handler: async ( argv ) => {
			try {
				const typedArgv = argv as {
					message?: string;
					json?: boolean;
					sessionPersistence?: boolean;
				};
				const noSessionPersistence = typedArgv.sessionPersistence === false;
				const adapter = typedArgv.json ? new JsonAdapter() : new InteractiveAdapter();

				await runCommand( {
					adapter,
					initialMessage: typedArgv.message,
					noSessionPersistence,
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
