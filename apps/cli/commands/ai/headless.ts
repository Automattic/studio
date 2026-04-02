/**
 * Headless AI agent worker — spawned by the desktop app via fork().
 * Communicates exclusively over Node IPC (process.send / process.on('message')).
 * No terminal UI, no stdin/stdout interaction.
 */
import crypto from 'crypto';
import { startAiAgent, type AiModelId } from 'cli/ai/agent';
import { resolveAiEnvironment, resolveInitialAiProvider } from 'cli/ai/auth';
import { type AskUserQuestion, type PathGatedApprovalDecision } from 'cli/ai/security';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { AiProviderId } from 'cli/ai/providers';

// --- IPC Message Types ---

interface ImageAttachment {
	data: string;
	mediaType: string;
}

interface StartMessage {
	type: 'ai:start';
	prompt: string;
	model?: AiModelId;
	resume?: string;
	sitePath?: string;
	siteName?: string;
	provider?: AiProviderId;
	images?: ImageAttachment[];
}

interface FollowUpMessage {
	type: 'ai:follow-up';
	message: string;
	images?: ImageAttachment[];
}

interface InterruptMessage {
	type: 'ai:interrupt';
}

interface PermissionResponseMessage {
	type: 'ai:permission-response';
	requestId: string;
	decision: PathGatedApprovalDecision;
}

interface KillMessage {
	type: 'ai:kill';
}

type DesktopToCliMessage =
	| StartMessage
	| FollowUpMessage
	| InterruptMessage
	| PermissionResponseMessage
	| KillMessage;

// Pending permission requests — keyed by requestId
const pendingPermissions = new Map<
	string,
	{ resolve: ( decision: PathGatedApprovalDecision ) => void }
>();

let activeQuery: Query | null = null;

function send( message: Record< string, unknown > ): void {
	if ( process.send ) {
		process.send( message );
	}
}

/**
 * Create an onAskUser handler that routes permission prompts through IPC
 * instead of terminal stdin/stdout.
 */
function createIpcAskUserHandler(): (
	questions: AskUserQuestion[]
) => Promise< Record< string, string > > {
	return async ( questions ) => {
		const answers: Record< string, string > = {};

		for ( const question of questions ) {
			const requestId = crypto.randomUUID();
			const promise = new Promise< PathGatedApprovalDecision >( ( resolve ) => {
				pendingPermissions.set( requestId, { resolve } );
			} );

			// Send permission request to desktop
			send( {
				type: 'ai:permission-request',
				requestId,
				description: question.question,
				options: question.options,
			} );

			const decision = await promise;

			// Map the decision back to the expected answer format
			const option = question.options.find( ( opt ) => {
				if ( decision === 'allow_once' ) {
					return opt.label.toLowerCase().includes( 'once' );
				}
				if ( decision === 'allow_session' ) {
					return opt.label.toLowerCase().includes( 'session' );
				}
				return opt.label.toLowerCase().includes( 'deny' );
			} );

			answers[ question.question ] = option?.label ?? question.options[ 0 ]?.label ?? '';
		}

		return answers;
	};
}

/**
 * Build Anthropic API content blocks from text and optional images.
 */
function buildContentBlocks(
	text: string,
	images?: ImageAttachment[]
): Array<
	| { type: 'text'; text: string }
	| { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
> {
	const blocks: Array<
		| { type: 'text'; text: string }
		| { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
	> = [];

	if ( images?.length ) {
		for ( const img of images ) {
			blocks.push( {
				type: 'image',
				source: { type: 'base64', media_type: img.mediaType, data: img.data },
			} );
		}
	}

	blocks.push( { type: 'text', text } );

	return blocks;
}

async function handleStart( message: StartMessage ): Promise< void > {
	const {
		prompt,
		model,
		resume,
		sitePath,
		siteName,
		provider: requestedProvider,
		images,
	} = message;

	try {
		// Resolve provider and environment
		const provider = requestedProvider ?? ( await resolveInitialAiProvider() );
		const env = await resolveAiEnvironment( provider );

		// Prepend site context to prompt (matching CLI's runAgentTurn pattern)
		let enrichedPrompt = prompt;
		if ( sitePath ) {
			enrichedPrompt = `[Active site: "${
				siteName ?? 'site'
			}" at ${ sitePath } (running)]\n\n${ prompt }`;
		}

		// If images are attached, use the async iterable form with multimodal content
		const hasImages = images && images.length > 0;
		const promptOrStream = hasImages
			? ( async function* () {
					yield {
						type: 'user' as const,
						message: {
							role: 'user' as const,
							content: buildContentBlocks( enrichedPrompt, images ),
						},
						parent_tool_use_id: null,
						session_id: '',
					};
			  } )()
			: enrichedPrompt;

		const agentQuery = startAiAgent( {
			prompt: promptOrStream,
			env,
			model,
			resume,
			onAskUser: createIpcAskUserHandler(),
		} );

		activeQuery = agentQuery;

		// Message loop — forward each SDK message to the desktop
		for await ( const sdkMessage of agentQuery ) {
			send( { type: 'ai:sdk-message', message: sdkMessage } );

			// Capture session ID from result messages
			if ( sdkMessage.session_id ) {
				send( { type: 'ai:session-id', sessionId: sdkMessage.session_id } );
			}
		}

		send( { type: 'ai:done' } );
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		send( { type: 'ai:error', error: errorMessage } );
	} finally {
		activeQuery = null;
	}
}

function handleFollowUp( message: FollowUpMessage ): void {
	if ( ! activeQuery ) {
		send( { type: 'ai:error', error: 'No active agent to send follow-up to' } );
		return;
	}

	const hasImages = message.images && message.images.length > 0;
	const content = hasImages
		? buildContentBlocks( message.message, message.images )
		: message.message;

	const sdkMessage = {
		type: 'user' as const,
		message: { role: 'user' as const, content },
		parent_tool_use_id: null,
		session_id: '',
	};

	void activeQuery.streamInput(
		( async function* () {
			yield sdkMessage;
		} )()
	);
}

function handleInterrupt(): void {
	if ( activeQuery ) {
		void activeQuery.interrupt();
	}
}

function handlePermissionResponse( message: PermissionResponseMessage ): void {
	const pending = pendingPermissions.get( message.requestId );
	if ( pending ) {
		pendingPermissions.delete( message.requestId );
		pending.resolve( message.decision );
	}
}

function handleKill(): void {
	if ( activeQuery ) {
		activeQuery.close();
		activeQuery = null;
	}
	process.exit( 0 );
}

/**
 * Entry point for the headless agent worker.
 * Must be spawned with IPC channel (fork with stdio including 'ipc').
 */
export async function runHeadlessAgent(): Promise< void > {
	if ( ! process.send ) {
		console.error( 'Headless agent must be spawned with IPC channel (use fork).' );
		process.exit( 1 );
	}

	// Signal to the desktop that we're ready
	send( { type: 'ai:ready' } );

	// Listen for messages from the desktop
	process.on( 'message', ( raw: unknown ) => {
		const message = raw as DesktopToCliMessage;

		switch ( message.type ) {
			case 'ai:start':
				void handleStart( message );
				break;
			case 'ai:follow-up':
				handleFollowUp( message );
				break;
			case 'ai:interrupt':
				handleInterrupt();
				break;
			case 'ai:permission-response':
				handlePermissionResponse( message );
				break;
			case 'ai:kill':
				handleKill();
				break;
		}
	} );

	// Keep the process alive
	process.on( 'disconnect', () => {
		// Parent died — clean up and exit
		if ( activeQuery ) {
			activeQuery.close();
		}
		process.exit( 0 );
	} );
}
