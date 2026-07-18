import { buildChatAttachmentSummaries } from '@studio/common/ai/chat-attachments';
import {
	buildAttachedFilesPromptBlock,
	type StudioChatFileAttachment,
} from '@studio/common/ai/chat-files';
import { type StudioChatImage } from '@studio/common/ai/chat-images';
import { DEFAULT_MODEL, resolveSessionModel, type AiModelId } from '@studio/common/ai/models';
import { DEFAULT_RESPONSE_LENGTH, type AiResponseLength } from '@studio/common/ai/response-length';
import { getAgentEndTurnResult } from '@studio/common/ai/session-events';
import { buildSkillInvocationPrompt } from '@studio/common/ai/slash-commands';
import { readAuthToken, readSharedConfig } from '@studio/common/lib/shared-config';
import { getSessionsDirectory } from '@studio/common/lib/well-known-paths';
import { __, sprintf } from '@wordpress/i18n';
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
import { setChatArtifactCallback } from 'cli/ai/chat-artifacts';
import { startDaemonStatusPolling } from 'cli/ai/daemon-status-poll';
import { type AiOutputAdapter, JsonAdapter } from 'cli/ai/output-adapter';
import { AI_PROVIDERS, getAiProviderDefinition, type AiProviderId } from 'cli/ai/providers';
import { runStudioAgentTurn } from 'cli/ai/runtimes/pi';
import { setScreenshotDirectoryProvider } from 'cli/ai/screenshot-storage';
import { resolveResumeSessionContext } from 'cli/ai/sessions/context';
import {
	createStudioSession,
	listStudioSessionFiles,
	openStudioSession,
} from 'cli/ai/sessions/pi-session';
import { replaySessionHistory } from 'cli/ai/sessions/replay';
import { setLocalSiteSelectedCallback } from 'cli/ai/site-selection';
import { getActiveSlashCommands, type SlashCommandContext } from 'cli/ai/slash-commands';
import { AiChatUI } from 'cli/ai/ui';
import { runCommand as runLoginCommand } from 'cli/commands/auth/login';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { findSiteByFolder, findSiteById } from 'cli/lib/cli-config/sites';
import { disconnectFromDaemon } from 'cli/lib/daemon-client';
import { isSiteRunning } from 'cli/lib/site-utils';
import { maybeShowTosNotice } from 'cli/lib/tos-notice';
import { Logger, LoggerError, setProgressCallback } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type {
	StudioCustomEntryDataMap,
	StudioCustomEntryType,
} from '@studio/common/ai/sessions/entry-types';
import type { LoadedAiSession, TurnStatus } from '@studio/common/ai/sessions/types';
import type { PermissionDecision, PermissionRequestData } from '@studio/common/ai/tool-permissions';
import type { AskUserQuestion } from 'cli/ai/types';

const logger = new Logger< string >();

// Resolved fresh each turn so a change made in the desktop settings (or via
// `/response-length`) applies from the next message, including in already
// running interactive sessions.
async function resolveResponseLength(): Promise< AiResponseLength > {
	try {
		const config = await readSharedConfig();
		return config.agentResponseLength ?? DEFAULT_RESPONSE_LENGTH;
	} catch {
		return DEFAULT_RESPONSE_LENGTH;
	}
}

// The model sessions start on when they haven't recorded one themselves;
// set from the desktop settings screens ("Default model").
async function resolveDefaultModel(): Promise< AiModelId > {
	try {
		const config = await readSharedConfig();
		return config.defaultAiModel ?? DEFAULT_MODEL;
	} catch {
		return DEFAULT_MODEL;
	}
}

// Type-safe wrapper around `sm.appendCustomEntry` — the underlying call
// accepts `data: unknown`, so this constrains `data` to the shape declared
// for each `studio.*` customType in `StudioCustomEntryDataMap`.
function appendStudioEntry< T extends StudioCustomEntryType >(
	sm: SessionManager,
	customType: T,
	data: StudioCustomEntryDataMap[ T ]
): string {
	return sm.appendCustomEntry( customType, data );
}

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

async function readAllStdin(): Promise< string > {
	const chunks: Buffer[] = [];
	for await ( const chunk of process.stdin ) {
		chunks.push( typeof chunk === 'string' ? Buffer.from( chunk ) : ( chunk as Buffer ) );
	}
	return Buffer.concat( chunks ).toString( 'utf8' ).trim();
}

export async function runCommand( options: {
	adapter: AiOutputAdapter;
	initialMessage?: string;
	initialDisplayMessage?: string;
	initialImages?: StudioChatImage[];
	initialFiles?: StudioChatFileAttachment[];
	resumeSession?: LoadedAiSession;
	resumeSessionId?: string;
	showLegacyCommandNotice?: boolean;
	activeSite?: {
		id?: string;
		name: string;
		path: string;
		remote?: boolean;
		url?: string;
		wpcomSiteId?: number;
	};
} ): Promise< void > {
	const ui = options.adapter;
	const isJsonMode = ui instanceof JsonAdapter;
	const preferredDefaultModel = await resolveDefaultModel();
	const resumeContext = resolveResumeSessionContext( options.resumeSession, preferredDefaultModel );
	let currentProvider: AiProviderId =
		resumeContext.provider ?? ( await resolveInitialAiProvider() );
	let currentModel: AiModelId = resumeContext.model ?? preferredDefaultModel;
	ui.currentProvider = currentProvider;
	ui.currentModel = currentModel;
	if ( options.activeSite ) {
		ui.activeSite = {
			id: options.activeSite.id,
			name: options.activeSite.name,
			path: options.activeSite.path,
			// Placeholder — turn dispatch resolves the live state before each prompt.
			running: false,
			remote: options.activeSite.remote,
			url: options.activeSite.url,
			wpcomSiteId: options.activeSite.wpcomSiteId,
		};
	}
	ui.start();
	ui.showWelcome();

	await maybeShowTosNotice( () => ui.showTosNotice() );

	if ( options.showLegacyCommandNotice && ! isJsonMode ) {
		ui.showInfo( __( 'ⓘ The "studio ai" command is now "studio code".' ) );
	}

	let session: SessionManager | undefined;

	const ensureSession = async (): Promise< SessionManager > => {
		if ( session ) return session;

		if ( options.resumeSession ) {
			session = await openStudioSession( options.resumeSession.summary.filePath );
		} else if ( options.resumeSessionId ) {
			const files = await listStudioSessionFiles( getSessionsDirectory() );
			let match: string | undefined;
			for ( const file of files ) {
				try {
					const sm = await openStudioSession( file );
					if ( sm.getSessionId() === options.resumeSessionId ) {
						session = sm;
						match = file;
						currentModel = resolveSessionModel( sm.getEntries(), preferredDefaultModel );
						ui.currentModel = currentModel;
						break;
					}
				} catch {
					// Skip unreadable files.
				}
			}
			if ( ! match ) {
				throw new Error(
					sprintf(
						/* translators: %s: agent session ID */
						__( 'No AI session found for resume ID: %s' ),
						options.resumeSessionId
					)
				);
			}
		} else {
			session = await createStudioSession();
		}

		return session!;
	};

	const append = async ( fn: ( sm: SessionManager ) => void ): Promise< void > => {
		const sm = await ensureSession();
		fn( sm );
	};

	if ( ui instanceof JsonAdapter ) {
		ui.onBeforeExit = async () => {
			ui.stop();
		};
	}

	async function persistSessionContext(): Promise< void > {
		await append( ( sm ) =>
			appendStudioEntry( sm, 'studio.session_context', {
				provider: currentProvider,
				model: currentModel,
			} )
		);
	}

	setProgressCallback( ( message, update ) => {
		ui.setLoaderMessage( message, update );
	} );

	setChatArtifactCallback( ( artifact ) =>
		append( ( sm ) => appendStudioEntry( sm, 'studio.chat_artifact', artifact ) )
	);

	// Persist screenshots next to the session file (`<session>.screenshots/`)
	// so artifacts in the transcript keep rendering after OS temp cleanup;
	// `deleteAiSession` removes the sidecar together with the session.
	setScreenshotDirectoryProvider( async () => {
		const sm = await ensureSession();
		const sessionFile = sm.getSessionFile();
		if ( ! sessionFile?.endsWith( '.jsonl' ) ) {
			return null;
		}
		return `${ sessionFile.slice( 0, -'.jsonl'.length ) }.screenshots`;
	} );

	ui.onSiteSelected = ( site ) => {
		void append( ( sm ) =>
			appendStudioEntry( sm, 'studio.site_selected', {
				siteName: site.name,
				sitePath: site.path,
				siteId: site.id,
				remote: site.remote,
				url: site.url,
				wpcomSiteId: site.wpcomSiteId,
			} )
		);
	};

	setLocalSiteSelectedCallback(
		ui instanceof JsonAdapter
			? async ( site ) => {
					ui.activeSite = site;
					await append( ( sm ) =>
						appendStudioEntry( sm, 'studio.site_selected', {
							siteName: site.name,
							sitePath: site.path,
							siteId: site.id,
						} )
					);
			  }
			: null
	);

	if ( options.resumeSession ) {
		ui.showInfo(
			sprintf(
				/* translators: %s: session ID */
				__( 'Resuming session %s' ),
				options.resumeSession.summary.id
			)
		);
		const sm = await ensureSession();
		if ( ui instanceof AiChatUI && sm ) {
			replaySessionHistory( ui, sm.getEntries() );
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

		// Auto-correct model when the provider change leaves it unsupported
		// (e.g. switching from wpcom → anthropic-api-key while a GPT model is
		// selected). Fall back to the provider's default.
		const definition = getAiProviderDefinition( currentProvider );
		if ( ! definition.supportsModel( currentModel ) ) {
			currentModel = definition.defaultModel;
			ui.currentModel = currentModel;
		}

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
		// If the UI already surfaced a descriptive error (e.g. the AI usage
		// cap was reached), suppress the generic SDK exit error (e.g.
		// "Claude Code process exited with code 1") that follows.
		if ( ui instanceof AiChatUI && ui.hasErrorBeenSurfaced() ) {
			return;
		}

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

	// Studio Code Desktop defaults to WordPress.com provider.
	if ( isJsonMode && showCapabilitiesOnConnect ) {
		await switchProvider( 'wpcom', false );
		showCapabilitiesOnConnect = false;
	}

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
			await append( ( sm ) =>
				appendStudioEntry( sm, 'studio.agent_question', {
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
			await append( ( sm ) =>
				appendStudioEntry( sm, 'studio.user_prompt', {
					text: answer,
					source: 'ask_user',
					sitePath: ui.activeSite?.path,
				} )
			);
		}

		return answers;
	}

	// Persist the request before asking (so a session that dies mid-question
	// still shows what was pending) and the decision after. Blocks the agent
	// turn until the user decides; the UI resolves dismissal as deny.
	async function requestPermissionAndPersist(
		request: PermissionRequestData
	): Promise< PermissionDecision > {
		await append( ( sm ) => appendStudioEntry( sm, 'studio.permission_request', request ) );
		const decision = await ui.requestPermission( request );
		await append( ( sm ) =>
			appendStudioEntry( sm, 'studio.permission_response', { id: request.id, decision } )
		);
		return decision;
	}

	async function runAgentTurn(
		prompt: string,
		displayMessage = prompt,
		images: StudioChatImage[] = [],
		files: StudioChatFileAttachment[] = []
	): Promise< { status: TurnStatus; sessionId: string } > {
		await maybeAutoSwitchProvider();
		const sm = await ensureSession();
		const sessionId = sm.getSessionId();
		const env = await resolveAiEnvironment( currentProvider, {
			sessionId,
		} );

		ui.beginAgentTurn( sessionId );

		// Prepend active site context to the prompt.
		// Remote (WordPress.com) sites only have a URL and site ID; local sites have a filesystem path and running state.
		let enrichedPrompt = prompt;
		const site = ui.activeSite;
		// The stored running flag can be absent or stale — the session event log
		// carries no running state, replay hardcodes false, and the site can be
		// started/stopped mid-session — so ask the daemon before every turn.
		// Resolve by id when the session recorded one, so a folder reused by a
		// newer site can't redirect the turn; the registry record also refreshes
		// a moved site's current name/path. Old events only carry the path.
		if ( site && ! site.remote ) {
			const siteData = site.id
				? await findSiteById( site.id )
				: await findSiteByFolder( site.path );
			if ( siteData ) {
				site.id = siteData.id;
				site.name = siteData.name;
				site.path = siteData.path;
				site.running = await isSiteRunning( siteData );
			} else {
				site.running = false;
			}
			// isSiteRunning leaves a DaemonBus socket open, which keeps headless
			// (--json) runs alive after turn.completed; close it so the process
			// can exit naturally.
			await disconnectFromDaemon();
		}
		if ( site?.remote && site?.url ) {
			enrichedPrompt = `[Active site: "${ site.name }" (ID: ${ site.wpcomSiteId }) at ${ site.url } (WordPress.com)]\n\n${ prompt }`;
		} else if ( site ) {
			enrichedPrompt = `[Active site: "${ site.name }" at ${ site.path }${
				site.running ? ' (running)' : ' (stopped)'
			}]\n\n${ prompt }`;
		}

		// Non-image files ride as absolute-path references the agent reads with
		// its file tools (images travel separately as multimodal content blocks).
		if ( files.length > 0 ) {
			enrichedPrompt = `${ enrichedPrompt }${ buildAttachedFilesPromptBlock( files ) }`;
		}

		// Read the WP.com access token for remote sites
		let wpcomAccessToken: string | undefined;
		if ( site?.remote ) {
			const token = await readAuthToken();
			wpcomAccessToken = token?.accessToken;
		}

		await persistSessionContext();

		// Studio marker for the typed prompt; pi appends the real UserMessage.
		await append( ( s ) =>
			appendStudioEntry( s, 'studio.user_prompt', {
				text: displayMessage,
				source: 'prompt',
				sitePath: site?.path,
				attachments: buildChatAttachmentSummaries( images, files ),
			} )
		);

		const turnState: { status: TurnStatus } = { status: 'interrupted' };

		const agentQuery = runStudioAgentTurn( {
			prompt: enrichedPrompt,
			images,
			env,
			model: currentModel,
			responseLength: await resolveResponseLength(),
			session: sm,
			activeSite: site,
			wpcomAccessToken,
			onAskUser: ( questions ) => askUserAndPersistAnswers( questions ),
			onRequestPermission: ( request ) => requestPermissionAndPersist( request ),
			onEvent: ( event ) => {
				ui.handleEvent( event );
				// An `agent_end` with `willRetry` is not final — the session
				// restarts the turn after a backoff.
				if ( event.type !== 'agent_end' || event.willRetry ) {
					return;
				}
				const result = getAgentEndTurnResult( event );
				if ( result.interrupted ) {
					turnState.status = 'interrupted';
				} else {
					turnState.status = result.success ? 'success' : 'error';
				}
			},
		} );

		ui.onInterrupt = () => {
			void agentQuery.interrupt();
		};

		const consumeAgentTurnResult = agentQuery.result.catch( ( error ) => {
			turnState.status = 'error';
			// If the UI already surfaced a descriptive terminal error (e.g.
			// the AI usage cap was reached), suppress the generic SDK exit
			// error (e.g. "Claude Code process exited with code 1").
			if ( ! ( ui instanceof AiChatUI && ui.hasErrorBeenSurfaced() ) ) {
				ui.showError( getErrorMessage( error ) );
			}
			// In JSON mode there's no interactive retry, so re-throw and let
			// the caller record the error.
			if ( isJsonMode ) {
				throw error;
			}
		} );

		try {
			await consumeAgentTurnResult;
		} finally {
			await append( ( s ) =>
				appendStudioEntry( s, 'studio.turn_closed', { status: turnState.status } )
			);
			ui.endAgentTurn();
		}

		return {
			status: turnState.status,
			sessionId,
		};
	}

	// JSON mode: single turn, then exit
	if ( isJsonMode && options.initialMessage ) {
		try {
			const displayMessage = options.initialDisplayMessage ?? options.initialMessage;
			ui.addUserMessage( displayMessage );
			const result = await runAgentTurn(
				options.initialMessage,
				displayMessage,
				options.initialImages,
				options.initialFiles
			);
			const jsonStatus = result.status === 'interrupted' ? 'error' : result.status;
			( ui as JsonAdapter ).emitTurnCompleted( jsonStatus, result.sessionId );
		} catch ( error ) {
			process.exitCode = 1;
			handleAgentTurnError( error );
			( ui as JsonAdapter ).emitTurnCompleted( 'error', session?.getSessionId() ?? '' );
		} finally {
			setLocalSiteSelectedCallback( null );
			ui.stop();
			await closeSharedBrowser();
			// Catch-all for daemon sockets opened implicitly during the turn
			// (listProcesses connects on demand — e.g. checkpoints probing
			// isServerRunning). An open DaemonBus keeps this headless process
			// alive after turn.completed, so the desktop never sees run.exited
			// and the session sticks in the working state.
			await disconnectFromDaemon();
		}
		return;
	}

	// Run initial message before entering the input loop
	if ( options.initialMessage ) {
		const displayMessage = options.initialDisplayMessage ?? options.initialMessage;
		ui.addUserMessage( displayMessage );
		try {
			await runAgentTurn(
				options.initialMessage,
				displayMessage,
				options.initialImages,
				options.initialFiles
			);
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
			session = await createStudioSession();
			ui.clearTranscript();
			ui.showWelcome();
			ui.showInfo( __( 'Conversation cleared' ) );
			await persistSessionContext();
			const site = ui.activeSite;
			if ( site ) {
				await append( ( sm ) =>
					appendStudioEntry( sm, 'studio.site_selected', {
						siteName: site.name,
						sitePath: site.path,
						siteId: site.id,
						remote: site.remote,
						url: site.url,
						wpcomSiteId: site.wpcomSiteId,
					} )
				);
			}
		},
	};

	// Surface remote-session daemon status in the editor's bottom bar. Cheap
	// fs poll catches external start/stop (e.g. `studio code remote-session
	// stop` from another terminal) without blocking the REPL.
	const stopDaemonStatusPolling = startDaemonStatusPolling( ui );

	// --- Main loop ---
	try {
		while ( true ) {
			const prompt = await ui.waitForInput();
			const trimmedPrompt = prompt.trim();

			// Match exact-prompt by default (preserves the legacy behavior where
			// `/clear foo` falls through to the AI agent). Commands that opt into
			// arguments via `getArgumentCompletions` get first-token matching so
			// inputs like `/remote-session start` route to the right handler.
			const firstToken = trimmedPrompt.split( /\s+/, 1 )[ 0 ] ?? '';
			const cmd = trimmedPrompt.startsWith( '/' )
				? getActiveSlashCommands().find( ( c ) =>
						c.getArgumentCompletions
							? `/${ c.name }` === firstToken
							: `/${ c.name }` === trimmedPrompt
				  )
				: undefined;
			if ( cmd ) {
				if ( cmd.handler ) {
					const result = await cmd.handler( prompt, slashCommandContext );
					if ( result === 'break' ) {
						break;
					}
				} else {
					// Skill command — no handler, route to agent
					ui.addUserMessage( prompt );
					try {
						await runAgentTurn( buildSkillInvocationPrompt( cmd.name ) );
					} catch ( error ) {
						handleAgentTurnError( error );
					}
				}
				continue;
			}

			ui.addUserMessage( prompt );
			try {
				await runAgentTurn( prompt );
			} catch ( error ) {
				handleAgentTurnError( error );
			}
		}
	} finally {
		stopDaemonStatusPolling();
		ui.stop();
		process.exit( 0 );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: '$0 [message]',
		describe: __( 'Start an interactive AI chat to build WordPress sites' ),
		builder: ( yargs ) => {
			let chain = yargs
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
				.option( 'permission-decisions', {
					type: 'string',
					hidden: true,
					description: __(
						'JSON-encoded gated-tool decisions keyed by tool name, for resuming a session paused on a permission request'
					),
				} );

			// `--message-from-stdin` is the headless turn entry point used by the
			// remote-session daemon (see `apps/cli/remote-session/turn-runner.ts`).
			// It stays hidden so it doesn't clutter `--help` for direct callers.
			chain = chain.option( 'message-from-stdin', {
				type: 'boolean',
				hidden: true,
				default: false,
				description: __( 'Read the initial message from stdin (for headless drivers)' ),
			} );

			return chain.check( ( argv ) => {
				if ( argv.json && ! argv.message && ! argv.messageFromStdin ) {
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
					resumeSession?: string;
					permissionResponse?: string;
					permissionDecisions?: string;
					siteName?: string;
					messageFromStdin?: boolean;
				};

				const adapter: AiOutputAdapter = typedArgv.json ? new JsonAdapter() : new AiChatUI();

				let initialMessage = typedArgv.message;
				if ( typedArgv.messageFromStdin ) {
					initialMessage = await readAllStdin();
					if ( ! initialMessage ) {
						process.stderr.write(
							`${ __( '--message-from-stdin requires non-empty input on stdin' ) }\n`
						);
						process.exitCode = 1;
						return;
					}
				}

				if ( adapter instanceof JsonAdapter && typedArgv.permissionResponse ) {
					adapter.permissionResponse = JSON.parse( typedArgv.permissionResponse ) as Record<
						string,
						string
					>;
				}

				if ( adapter instanceof JsonAdapter && typedArgv.permissionDecisions ) {
					adapter.permissionDecisions = JSON.parse( typedArgv.permissionDecisions ) as Partial<
						Record< string, PermissionDecision >
					>;
				}

				const sitePath = typeof argv.path === 'string' ? argv.path : undefined;
				let activeSite: { id?: string; name: string; path: string } | undefined;
				if ( sitePath && typedArgv.siteName ) {
					activeSite = { name: typedArgv.siteName, path: sitePath };
				} else if ( sitePath ) {
					const matchedSite = await findSiteByFolder( sitePath );
					if ( matchedSite ) {
						activeSite = { id: matchedSite.id, name: matchedSite.name, path: matchedSite.path };
					}
				}
				await runCommand( {
					adapter,
					initialMessage,
					resumeSessionId: typedArgv.resumeSession,
					showLegacyCommandNotice: argv._[ 0 ] === 'ai',
					activeSite,
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
