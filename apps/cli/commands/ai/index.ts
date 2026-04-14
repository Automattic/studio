import { readAuthToken } from '@studio/common/lib/shared-config';
import { __, _n, sprintf } from '@wordpress/i18n';
import { DEFAULT_MODEL, startAiAgent, type AiModelId, type AskUserQuestion } from 'cli/ai/agent';
import {
	getAvailableAiProviders,
	isAiProviderReady,
	prepareAiProvider,
	resolveAiEnvironment,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
	saveSelectedAiProvider,
} from 'cli/ai/auth';
import { closeSharedBrowser } from 'cli/ai/browser-utils';
import { type AiOutputAdapter, JsonAdapter } from 'cli/ai/output-adapter';
import { AI_PROVIDERS, type AiProviderId } from 'cli/ai/providers';
import { resolveResumeSessionContext } from 'cli/ai/sessions/context';
import { AiSessionRecorder } from 'cli/ai/sessions/recorder';
import { replaySessionHistory } from 'cli/ai/sessions/replay';
import { listAiSessions } from 'cli/ai/sessions/store';
import { type LoadedAiSession, type TurnStatus } from 'cli/ai/sessions/types';
import { AI_CHAT_SLASH_COMMANDS, type SlashCommandContext } from 'cli/ai/slash-commands';
import { AiChatUI } from 'cli/ai/ui';
import { runCommand as runLoginCommand } from 'cli/commands/auth/login';
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
	resumeSessionId?: string;
	noSessionPersistence?: boolean;
	autoApprove?: boolean;
	showLegacyCommandNotice?: boolean;
	activeSite?: { name: string; path: string; running?: boolean };
} ): Promise< void > {
	const ui = options.adapter;
	const isJsonMode = ui instanceof JsonAdapter;
	const resumeContext = resolveResumeSessionContext( options.resumeSession );
	let currentProvider: AiProviderId =
		resumeContext.provider ?? ( await resolveInitialAiProvider() );
	let currentModel: AiModelId = resumeContext.model ?? DEFAULT_MODEL;
	ui.currentProvider = currentProvider;
	ui.currentModel = currentModel;
	if ( options.activeSite ) {
		ui.activeSite = {
			name: options.activeSite.name,
			path: options.activeSite.path,
			running: options.activeSite.running ?? false,
		};
	}
	ui.start();
	ui.showWelcome();

	if ( options.showLegacyCommandNotice && ! isJsonMode ) {
		ui.showInfo( __( 'ⓘ The "studio ai" command is now "studio code".' ) );
	}

	let sessionRecorder: AiSessionRecorder | undefined;
	let didDisableSessionPersistence = options.noSessionPersistence === true;
	let sessionId: string | undefined = options.resumeSessionId ?? resumeContext.sessionId;
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
			} else if ( options.resumeSessionId ) {
				// Find existing session file by SDK agent session ID so
				// follow-up turns append to the same file instead of creating new ones.
				const sessions = await listAiSessions();
				const existing = sessions.find( ( s ) =>
					s.linkedAgentSessionIds.includes( options.resumeSessionId! )
				);
				if ( existing ) {
					sessionRecorder = await AiSessionRecorder.open( {
						sessionId: existing.id,
						filePath: existing.filePath,
						linkedAgentSessionIds: existing.linkedAgentSessionIds,
					} );
				} else {
					sessionRecorder = await AiSessionRecorder.create();
				}
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

	if ( ui instanceof JsonAdapter ) {
		ui.onBeforeExit = async () => {
			await persistQueue;
			ui.stop();
		};
	}

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
		void persist( ( recorder ) => recorder.recordSiteSelected( site ) );
	};

	if ( options.resumeSession ) {
		ui.showInfo(
			sprintf(
				/* translators: %s: session ID */
				__( 'Resuming session %s' ),
				options.resumeSession.summary.id
			)
		);
		if ( ui instanceof AiChatUI ) {
			replaySessionHistory( ui, options.resumeSession.events );
		}
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

	const config = await readCliConfig();
	let showCapabilitiesOnConnect = ! config.aiProvider;

	if ( showCapabilitiesOnConnect ) {
		ui.showOnboarding();

		// Auto-trigger provider selection on first run
		const availableProviders = await getAvailableAiProviders();
		const labelToProvider = new Map< string, AiProviderId >();
		const providerOptions = availableProviders.map( ( id ) => {
			const label = id === 'wpcom' ? __( 'WordPress.com (recommended)' ) : AI_PROVIDERS[ id ];
			labelToProvider.set( label, id );
			return { label, description: id };
		} );
		const answer = await ui.askUser( [
			{
				question: __( 'Choose how to connect' ),
				options: providerOptions,
			},
		] );
		const selectedLabel = Object.values( answer )[ 0 ] as string;
		const selectedProvider = labelToProvider.get( selectedLabel );
		if ( selectedProvider ) {
			try {
				if ( selectedProvider === 'wpcom' ) {
					// Run login flow directly instead of prepare(), which would
					// just throw "login required" since there's no token yet.
					ui.stop();
					await runLoginCommand();
					ui.start();

					if ( await isAiProviderReady( 'wpcom' ) ) {
						await switchProvider( 'wpcom', false );
						const token = await readAuthToken();
						if ( token ) {
							ui.showSuccess(
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
							showCapabilitiesOnConnect = false;
							ui.showCapabilities();
						}
					}
				} else {
					await prepareProviderSelection( selectedProvider );
					await switchProvider( selectedProvider, false );
					showCapabilitiesOnConnect = false;
					ui.showCapabilities();
				}
			} catch ( error ) {
				if ( ! isPromptAbortError( error ) ) {
					if ( error instanceof LoggerError ) {
						ui.showError( error.message );
					} else {
						throw error;
					}
				}
			}
		}
	} else if ( currentProvider === 'wpcom' ) {
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
	} else if ( currentProvider === 'anthropic-api-key' && ! config.anthropicApiKey ) {
		ui.showInfo( __( 'No Anthropic API key saved. Use /api-key to enter one.' ) );
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
	): Promise< { status: TurnStatus; usage?: { numTurns: number; costUsd?: number } } > {
		const env = await resolveAiEnvironment( currentProvider );
		ui.beginAgentTurn();

		// Prepend active site context to the prompt.
		// Remote (WordPress.com) sites only have a URL and site ID; local sites have a filesystem path and running state.
		let enrichedPrompt = prompt;
		const site = ui.activeSite;
		if ( site?.remote && site?.url ) {
			enrichedPrompt = `[Active site: "${ site.name }" (ID: ${ site.wpcomSiteId }) at ${ site.url } (WordPress.com)]\n\n${ prompt }`;
		} else if ( site ) {
			enrichedPrompt = `[Active site: "${ site.name }" at ${ site.path }${
				site.running ? ' (running)' : ' (stopped)'
			}]\n\n${ prompt }`;
		}

		// Read the WP.com access token for remote sites
		let wpcomAccessToken: string | undefined;
		if ( site?.remote ) {
			const token = await readAuthToken();
			wpcomAccessToken = token?.accessToken;
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
			autoApprove: options.autoApprove ?? isJsonMode,
			activeSite: site,
			wpcomAccessToken,
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

					if ( result.type === 'max_turns' ) {
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
	if ( isJsonMode && options.initialMessage ) {
		try {
			await maybeAutoSwitchProvider();
			ui.addUserMessage( options.initialMessage );
			const result = await runAgentTurn( options.initialMessage );
			const jsonStatus = result.status === 'interrupted' ? 'error' : result.status;
			( ui as JsonAdapter ).emitTurnCompleted( jsonStatus, result.usage );
		} catch ( error ) {
			process.exitCode = 1;
			handleAgentTurnError( error );
			( ui as JsonAdapter ).emitTurnCompleted( 'error' );
		} finally {
			await persistQueue;
			ui.stop();
			await closeSharedBrowser();
		}
		return;
	}

	// Run initial message before entering the input loop
	if ( options.initialMessage ) {
		ui.addUserMessage( options.initialMessage );
		try {
			await runAgentTurn( options.initialMessage );
		} catch ( error ) {
			handleAgentTurnError( error );
		}
	}

	if ( ! ( ui instanceof AiChatUI ) ) {
		throw new Error( 'Interactive mode requires AiChatUI adapter' );
	}

	const slashCommandContext: SlashCommandContext = {
		ui,
		get currentModel() {
			return currentModel;
		},
		set currentModel( value ) {
			currentModel = value;
		},
		get currentProvider() {
			return currentProvider;
		},
		get showCapabilitiesOnConnect() {
			return showCapabilitiesOnConnect;
		},
		set showCapabilitiesOnConnect( value ) {
			showCapabilitiesOnConnect = value;
		},
		switchProvider,
		prepareProviderSelection,
		maybeAutoSwitchProvider,
		persistSessionContext,
		async clearSession() {
			sessionId = undefined;
			ui.clearTranscript();
			ui.showWelcome();
			ui.showInfo( __( 'Conversation cleared' ) );
			await persist( ( recorder ) => recorder.recordSessionCleared() );
			await persistSessionContext();
			const site = ui.activeSite;
			if ( site ) {
				await persist( ( recorder ) => recorder.recordSiteSelected( site ) );
			}
		},
	};

	// --- Main loop ---
	try {
		while ( true ) {
			const prompt = await ui.waitForInput();
			const trimmedPrompt = prompt.trim();

			const cmd = AI_CHAT_SLASH_COMMANDS.find( ( c ) => `/${ c.name }` === trimmedPrompt );
			if ( cmd ) {
				if ( cmd.handler ) {
					const result = await cmd.handler( prompt, slashCommandContext );
					if ( result === 'break' ) {
						break;
					}
				} else {
					// Skill command — no handler, route to agent
					await maybeAutoSwitchProvider();
					ui.addUserMessage( prompt );
					try {
						await runAgentTurn( `Run the /${ cmd.name } skill using the Skill tool.` );
					} catch ( error ) {
						handleAgentTurnError( error );
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
		describe: __( 'AI agent for building WordPress' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'message', {
					type: 'string',
					description: __( 'Initial message to send to the AI agent' ),
				} )
				.option( 'path', {
					hidden: true,
				} )
				.option( 'site-name', {
					type: 'string',
					hidden: true,
					description: __( 'Name of the active WordPress site' ),
				} )
				.option( 'json', {
					type: 'boolean',
					default: false,
					description: __( 'Output events as NDJSON to stdout (headless mode)' ),
				} )
				.option( 'auto-approve', {
					type: 'boolean',
					description: __( 'Auto-approve all tool calls (defaults to true in --json mode)' ),
				} )
				.option( 'resume-session', {
					type: 'string',
					hidden: true,
					description: __( 'SDK session ID to resume (for JSON mode multi-turn)' ),
				} )
				.option( 'permission-response', {
					type: 'string',
					hidden: true,
					description: __( 'JSON-encoded permission response for a paused session' ),
				} )
				.option( 'session-persistence', {
					type: 'boolean',
					default: true,
					description: __( 'Record this code session to disk' ),
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
					autoApprove?: boolean;
					resumeSession?: string;
					permissionResponse?: string;
					siteName?: string;
				};
				const noSessionPersistence = typedArgv.sessionPersistence === false;
				const adapter: AiOutputAdapter = typedArgv.json ? new JsonAdapter() : new AiChatUI();

				if ( adapter instanceof JsonAdapter && typedArgv.permissionResponse ) {
					adapter.permissionResponse = JSON.parse( typedArgv.permissionResponse ) as Record<
						string,
						string
					>;
				}

				const sitePath = typeof argv.path === 'string' ? argv.path : undefined;
				await runCommand( {
					adapter,
					initialMessage: typedArgv.message,
					resumeSessionId: typedArgv.resumeSession,
					noSessionPersistence,
					autoApprove: typedArgv.autoApprove,
					showLegacyCommandNotice: argv._[ 0 ] === 'ai',
					activeSite:
						sitePath && typedArgv.siteName
							? { name: typedArgv.siteName, path: sitePath }
							: undefined,
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
