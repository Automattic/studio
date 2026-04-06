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

interface ElementAttachment {
	cssSelector: string;
	tagName: string;
	outerHTML: string;
	textContent: string;
	computedStyles: Record< string, string >;
	boundingBox: { x: number; y: number; width: number; height: number };
	domPath: string[];
	wpBlockName?: string;
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
	elements?: ElementAttachment[];
}

interface FollowUpMessage {
	type: 'ai:follow-up';
	message: string;
	images?: ImageAttachment[];
	elements?: ElementAttachment[];
}

interface InterruptMessage {
	type: 'ai:interrupt';
}

interface PermissionResponseMessage {
	type: 'ai:permission-response';
	requestId: string;
	decision: PathGatedApprovalDecision;
}

interface QuestionResponseMessage {
	type: 'ai:question-response';
	requestId: string;
	answer: string;
}

interface KillMessage {
	type: 'ai:kill';
}

interface GenerateTitleMessage {
	type: 'ai:generate-title';
	prompt: string;
}

interface GenerateSummaryMessage {
	type: 'ai:generate-summary';
	title: string;
	firstMessage: string;
	firstResponse?: string;
	siteName?: string;
}

type DesktopToCliMessage =
	| StartMessage
	| FollowUpMessage
	| InterruptMessage
	| PermissionResponseMessage
	| QuestionResponseMessage
	| KillMessage
	| GenerateTitleMessage
	| GenerateSummaryMessage;

// Pending permission requests — keyed by requestId
const pendingPermissions = new Map<
	string,
	{ resolve: ( decision: PathGatedApprovalDecision ) => void }
>();

// Pending question requests — keyed by requestId
const pendingQuestions = new Map< string, { resolve: ( answer: string ) => void } >();

let activeQuery: Query | null = null;

function send( message: Record< string, unknown > ): void {
	if ( process.send ) {
		process.send( message );
	}
}

/**
 * Create an onAskUser handler that routes questions through IPC
 * to the desktop UI for interactive selection.
 */
function createIpcAskUserHandler(): (
	questions: AskUserQuestion[]
) => Promise< Record< string, string > > {
	return async ( questions ) => {
		const answers: Record< string, string > = {};

		for ( const question of questions ) {
			const requestId = crypto.randomUUID();
			const promise = new Promise< string >( ( resolve ) => {
				pendingQuestions.set( requestId, { resolve } );
			} );

			// Send question request to desktop
			send( {
				type: 'ai:question-request',
				requestId,
				question: question.question,
				options: question.options,
			} );

			// Wait for the user to pick an option or type a custom answer
			answers[ question.question ] = await promise;
		}

		return answers;
	};
}

/**
 * Serialize selected elements into a structured text block for the agent prompt.
 */
function serializeElementContext( elements: ElementAttachment[] ): string {
	const sections = elements.map( ( el, i ) => {
		const lines = [
			`## Selected Element ${ i + 1 }`,
			`- Selector: \`${ el.cssSelector }\``,
			`- Tag: <${ el.tagName }>`,
			`- WordPress Block: ${ el.wpBlockName || 'none' }`,
			`- Bounding Box: ${ el.boundingBox.width }x${ el.boundingBox.height } at (${ el.boundingBox.x }, ${ el.boundingBox.y })`,
			`- Styles: ${ JSON.stringify( el.computedStyles ) }`,
			`- DOM Path: ${ el.domPath.join( ' > ' ) }`,
			`- HTML:\n\`\`\`html\n${ el.outerHTML }\n\`\`\``,
		];
		if ( el.textContent ) {
			lines.splice( 3, 0, `- Text: "${ el.textContent }"` );
		}
		return lines.join( '\n' );
	} );
	return `<element-context>\n${ sections.join( '\n\n' ) }\n</element-context>`;
}

/**
 * Build Anthropic API content blocks from text, optional images, and optional elements.
 */
function buildContentBlocks(
	text: string,
	images?: ImageAttachment[],
	elements?: ElementAttachment[]
): Array<
	| { type: 'text'; text: string }
	| { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
> {
	const blocks: Array<
		| { type: 'text'; text: string }
		| { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
	> = [];

	if ( elements?.length ) {
		blocks.push( { type: 'text', text: serializeElementContext( elements ) } );
	}

	if ( images?.length ) {
		for ( const img of images ) {
			blocks.push( {
				type: 'image',
				source: { type: 'base64', media_type: img.mediaType, data: img.data },
			} );
		}
	}

	if ( text ) {
		blocks.push( { type: 'text', text } );
	} else if ( blocks.length === 0 ) {
		// Must have at least one block
		blocks.push( { type: 'text', text: '(no text)' } );
	}

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
		elements,
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

		// If images or elements are attached, use the async iterable form with multimodal content
		const hasAttachments = ( images && images.length > 0 ) || ( elements && elements.length > 0 );
		const promptOrStream = hasAttachments
			? ( async function* () {
					yield {
						type: 'user' as const,
						message: {
							role: 'user' as const,
							content: buildContentBlocks( enrichedPrompt, images, elements ),
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
		// Signal completion so the desktop cleans up and can resume on follow-up
		send( { type: 'ai:done' } );
	} finally {
		activeQuery = null;
	}
}

function handleFollowUp( message: FollowUpMessage ): void {
	if ( ! activeQuery ) {
		send( { type: 'ai:error', error: 'No active agent to send follow-up to' } );
		return;
	}

	const hasAttachments =
		( message.images && message.images.length > 0 ) ||
		( message.elements && message.elements.length > 0 );
	const content = hasAttachments
		? buildContentBlocks( message.message, message.images, message.elements )
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

function handleQuestionResponse( message: QuestionResponseMessage ): void {
	const pending = pendingQuestions.get( message.requestId );
	if ( pending ) {
		pendingQuestions.delete( message.requestId );
		pending.resolve( message.answer );
	}
}

const METADATA_MODEL = 'claude-haiku-4-5-20251001';

async function callAnthropicApi(
	env: Record< string, string >,
	systemPrompt: string,
	userMessage: string
): Promise< string | null > {
	const baseUrl = env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
	const url = `${ baseUrl }/v1/messages`;

	const headers: Record< string, string > = {
		'content-type': 'application/json',
		'anthropic-version': '2023-06-01',
	};

	if ( env.ANTHROPIC_API_KEY ) {
		headers[ 'x-api-key' ] = env.ANTHROPIC_API_KEY;
	}
	if ( env.ANTHROPIC_AUTH_TOKEN ) {
		headers.Authorization = `Bearer ${ env.ANTHROPIC_AUTH_TOKEN }`;
	}
	if ( env.ANTHROPIC_CUSTOM_HEADERS ) {
		for ( const pair of env.ANTHROPIC_CUSTOM_HEADERS.split( ',' ) ) {
			const [ key, ...rest ] = pair.split( ':' );
			if ( key && rest.length ) {
				headers[ key.trim() ] = rest.join( ':' ).trim();
			}
		}
	}

	try {
		const response = await fetch( url, {
			method: 'POST',
			headers,
			body: JSON.stringify( {
				model: METADATA_MODEL,
				max_tokens: 256,
				system: systemPrompt,
				messages: [ { role: 'user', content: userMessage } ],
			} ),
		} );

		if ( ! response.ok ) {
			return null;
		}

		const data = ( await response.json() ) as {
			content?: { type: string; text: string }[];
		};
		return data.content?.find( ( b ) => b.type === 'text' )?.text?.trim() ?? null;
	} catch {
		return null;
	}
}

async function handleGenerateTitle( message: GenerateTitleMessage ): Promise< void > {
	try {
		const provider = await resolveInitialAiProvider();
		const env = await resolveAiEnvironment( provider );

		const title = await callAnthropicApi(
			env,
			'Generate a short title (5-10 words max) for a task based on the user message below. The task is about modifying a WordPress site. Output ONLY the title text, nothing else. No quotes, no prefixes.',
			message.prompt
		);

		send( { type: 'ai:title-result', title } );
	} catch {
		send( { type: 'ai:title-result', title: null } );
	}
}

async function handleGenerateSummary( message: GenerateSummaryMessage ): Promise< void > {
	try {
		const provider = await resolveInitialAiProvider();
		const env = await resolveAiEnvironment( provider );

		const parts = [ `Task title: ${ message.title }`, `User request: ${ message.firstMessage }` ];
		if ( message.firstResponse ) {
			parts.push(
				`Assistant response (first 500 chars): ${ message.firstResponse.slice( 0, 500 ) }`
			);
		}
		if ( message.siteName ) {
			parts.push( `WordPress site: ${ message.siteName }` );
		}

		const summary = await callAnthropicApi(
			env,
			'Generate a 1-2 sentence summary of this task. Describe what was requested and what action was taken. Be concise and factual. Output ONLY the summary text.',
			parts.join( '\n' )
		);

		send( { type: 'ai:summary-result', summary } );
	} catch {
		send( { type: 'ai:summary-result', summary: null } );
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
			case 'ai:question-response':
				handleQuestionResponse( message );
				break;
			case 'ai:kill':
				handleKill();
				break;
			case 'ai:generate-title':
				void handleGenerateTitle( message );
				break;
			case 'ai:generate-summary':
				void handleGenerateSummary( message );
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
