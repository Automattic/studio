import readline from 'readline';
import { DEFAULT_MODEL, startAiAgent, type AiModelId } from 'cli/ai/agent';
import { resolveAiEnvironment, resolveInitialAiProvider } from 'cli/ai/auth';
import { AI_PROVIDER_PRIORITY, getAiProviderDefinition } from 'cli/ai/providers';
import { AI_CHAT_SLASH_COMMANDS } from 'cli/ai/slash-commands';
import type { HeadlessCommand, HeadlessEvent } from 'cli/ai/headless-types';

/**
 * Write a HeadlessEvent as a single JSON line to stdout.
 */
export function emitEvent( event: HeadlessEvent ): void {
	process.stdout.write( JSON.stringify( event ) + '\n' );
}

const VALID_COMMAND_TYPES = new Set< string >( [
	'message',
	'permission_response',
	'cancel',
	'slash_command',
] );

/**
 * Parse a single line of stdin into a HeadlessCommand, or return null if invalid.
 */
export function parseCommand( line: string ): HeadlessCommand | null {
	const trimmed = line.trim();
	if ( ! trimmed ) {
		return null;
	}
	try {
		const parsed = JSON.parse( trimmed );
		if ( typeof parsed === 'object' && parsed !== null && VALID_COMMAND_TYPES.has( parsed.type ) ) {
			return parsed as HeadlessCommand;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Create a readline-based command reader that buffers incoming stdin lines
 * and allows awaiting the next command.
 */
function createCommandReader() {
	const pendingLines: string[] = [];
	let pendingResolve: ( ( line: string ) => void ) | null = null;

	const rl = readline.createInterface( {
		input: process.stdin,
		terminal: false,
	} );

	rl.on( 'line', ( line ) => {
		if ( pendingResolve ) {
			const resolve = pendingResolve;
			pendingResolve = null;
			resolve( line );
		} else {
			pendingLines.push( line );
		}
	} );

	return {
		/**
		 * Wait for the next line from stdin. Supports AbortSignal to cancel the wait.
		 */
		nextLine( signal?: AbortSignal ): Promise< string > {
			if ( signal?.aborted ) {
				return Promise.reject( new DOMException( 'Aborted', 'AbortError' ) );
			}
			const buffered = pendingLines.shift();
			if ( buffered !== undefined ) {
				return Promise.resolve( buffered );
			}
			return new Promise( ( resolve, reject ) => {
				pendingResolve = resolve;
				if ( signal ) {
					const onAbort = () => {
						pendingResolve = null;
						reject( new DOMException( 'Aborted', 'AbortError' ) );
					};
					signal.addEventListener( 'abort', onAbort, { once: true } );
				}
			} );
		},

		/**
		 * Wait for a specific command type from stdin, discarding others.
		 * Also handles 'cancel' commands by throwing if received.
		 */
		async waitForCommand< T extends HeadlessCommand[ 'type' ] >(
			type: T,
			signal?: AbortSignal
		): Promise< Extract< HeadlessCommand, { type: T } > > {
			while ( true ) {
				const line = await this.nextLine( signal );
				const cmd = parseCommand( line );
				if ( cmd && cmd.type === type ) {
					return cmd as Extract< HeadlessCommand, { type: T } >;
				}
				if ( cmd?.type === 'cancel' ) {
					throw new DOMException( 'Cancelled by user', 'AbortError' );
				}
			}
		},

		close() {
			rl.close();
		},
	};
}

interface HeadlessOptions {
	siteName?: string;
	siteUrl?: string;
}

/**
 * Run the AI agent in headless mode, communicating via NDJSON on stdin/stdout.
 * This is the main entry point when `studio ai --headless` is invoked.
 */
export async function runHeadlessCommand( options: HeadlessOptions = {} ): Promise< void > {
	const reader = createCommandReader();
	const currentModel: AiModelId = DEFAULT_MODEL;
	let sessionId: string | undefined;

	try {
		// Resolve available providers
		const readyProviders: string[] = [];
		for ( const providerId of AI_PROVIDER_PRIORITY ) {
			const definition = getAiProviderDefinition( providerId );
			if ( await definition.isReady() ) {
				readyProviders.push( providerId );
			}
		}

		emitEvent( { type: 'ready', providers: readyProviders, model: currentModel } );

		// Emit available slash commands
		emitEvent( {
			type: 'slash_commands',
			commands: AI_CHAT_SLASH_COMMANDS.map( ( cmd ) => ( {
				name: cmd.name,
				description: cmd.description,
			} ) ),
		} );

		// Main command loop: wait for messages from the desktop app
		while ( true ) {
			const line = await reader.nextLine();
			const cmd = parseCommand( line );
			if ( ! cmd ) {
				continue;
			}

			if ( cmd.type === 'message' ) {
				await handleMessage( cmd.text, {
					reader,
					currentModel,
					sessionId,
					options,
					onSessionId: ( id ) => {
						sessionId = id;
					},
				} );
			} else if ( cmd.type === 'cancel' ) {
				// Cancel is handled within handleMessage via the query interrupt
				// If we get a cancel outside a turn, just ignore it
			} else if ( cmd.type === 'slash_command' ) {
				// Slash commands are handled by the desktop app; we just acknowledge
				emitEvent( {
					type: 'error',
					message: `Slash command /${ cmd.command } should be handled by the desktop app`,
					code: 'UNHANDLED_SLASH_COMMAND',
				} );
			}
		}
	} catch ( error ) {
		emitEvent( {
			type: 'error',
			message: error instanceof Error ? error.message : 'Unknown error',
			code: 'FATAL',
		} );
	} finally {
		reader.close();
	}
}

async function handleMessage(
	text: string,
	context: {
		reader: ReturnType< typeof createCommandReader >;
		currentModel: AiModelId;
		sessionId: string | undefined;
		options: HeadlessOptions;
		onSessionId: ( id: string ) => void;
	}
): Promise< void > {
	const { reader, currentModel, sessionId, options, onSessionId } = context;

	try {
		const currentProvider = await resolveInitialAiProvider();
		const env = await resolveAiEnvironment( currentProvider );

		// Enrich prompt with site context
		let enrichedPrompt = text;
		if ( options.siteUrl ) {
			enrichedPrompt = `[Active site: "${ options.siteName ?? 'Site' }" at ${
				options.siteUrl
			}]\n\n${ text }`;
		} else if ( options.siteName ) {
			enrichedPrompt = `[Active site: "${ options.siteName }"]\n\n${ text }`;
		}

		const agentQuery = startAiAgent( {
			prompt: enrichedPrompt,
			env,
			model: currentModel,
			resume: sessionId,
			onAskUser: async ( questions ) => {
				// In headless mode, permission questions are sent as permission_request events.
				// We use the first question's text as the description.
				const id = `perm_${ crypto.randomUUID() }`;
				const question = questions[ 0 ];
				emitEvent( {
					type: 'permission_request',
					id,
					toolName: 'AskUserQuestion',
					input: {},
					description: question?.question ?? 'Permission required',
				} );

				const response = await reader.waitForCommand( 'permission_response' );
				if ( response.allowed ) {
					// Return the first option as the answer (approved)
					const answers: Record< string, string > = {};
					for ( const q of questions ) {
						answers[ q.question ] = q.options[ 0 ]?.label ?? 'Yes';
					}
					return answers;
				}
				// Return the last option (typically deny)
				const answers: Record< string, string > = {};
				for ( const q of questions ) {
					answers[ q.question ] = q.options[ q.options.length - 1 ]?.label ?? 'No';
				}
				return answers;
			},
		} );

		// Listen for cancel commands while processing, with abort support
		const cancelController = new AbortController();
		const cancelListener = ( async () => {
			try {
				while ( ! cancelController.signal.aborted ) {
					const line = await reader.nextLine( cancelController.signal );
					const cmd = parseCommand( line );
					if ( cmd?.type === 'cancel' ) {
						void agentQuery.interrupt();
						return;
					}
				}
			} catch {
				// AbortError is expected when the turn completes normally
			}
		} )();

		// Track tool calls for mapping results
		const pendingToolCalls = new Map< string, { name: string } >();

		for await ( const message of agentQuery ) {
			switch ( message.type ) {
				case 'assistant': {
					for ( const block of message.message.content ) {
						if ( block.type === 'text' ) {
							emitEvent( { type: 'text_delta', text: block.text } );
						} else if ( block.type === 'tool_use' ) {
							const toolBlock = block as {
								id: string;
								name: string;
								input?: Record< string, unknown >;
							};
							pendingToolCalls.set( toolBlock.id, { name: toolBlock.name } );
							emitEvent( {
								type: 'tool_use_start',
								id: toolBlock.id,
								name: toolBlock.name,
								input: ( toolBlock.input as Record< string, unknown > ) ?? {},
							} );
						}
					}
					break;
				}
				case 'user': {
					const toolCallId = message.parent_tool_use_id;
					const toolCall = toolCallId ? pendingToolCalls.get( toolCallId ) : undefined;
					if ( toolCallId ) {
						pendingToolCalls.delete( toolCallId );
					}

					// Extract tool result content
					let output = '';
					let isError = false;
					for ( const block of message.message.content ) {
						if ( block.type === 'tool_result' ) {
							const resultBlock = block as {
								content?: string | { type: string; text?: string }[];
								is_error?: boolean;
							};
							isError = resultBlock.is_error ?? false;
							if ( typeof resultBlock.content === 'string' ) {
								output = resultBlock.content;
							} else if ( Array.isArray( resultBlock.content ) ) {
								output = resultBlock.content
									.filter(
										( c ): c is { type: string; text: string } =>
											typeof c === 'object' && 'text' in c
									)
									.map( ( c ) => c.text )
									.join( '\n' );
							}
						}
					}

					emitEvent( {
						type: 'tool_result',
						id: toolCallId ?? 'unknown',
						name: toolCall?.name ?? 'unknown',
						output,
						isError,
					} );
					break;
				}
				case 'result': {
					emitEvent( { type: 'text_complete' } );
					emitEvent( {
						type: 'turn_complete',
						turnCount: message.num_turns,
						cost: message.total_cost_usd,
						sessionId: message.session_id,
					} );
					onSessionId( message.session_id );
					break;
				}
			}
		}

		// Stop the cancel listener cleanly
		cancelController.abort();
		await cancelListener;
	} catch ( error ) {
		emitEvent( {
			type: 'error',
			message: error instanceof Error ? error.message : 'Agent turn failed',
		} );
	}
}
