import { randomUUID } from 'crypto';
import http from 'http';
import { Readable } from 'stream';

/**
 * Translates the Anthropic Messages API (spoken by the Claude Agent SDK / Claude Code
 * runtime) into requests against an OpenAI-compatible `/chat/completions` endpoint, and
 * translates the response back. This lets the AI agent be pointed at a local model server
 * (vLLM, Ollama, LM Studio, etc.) that only understands the OpenAI wire format.
 *
 * Scope: text and tool-calling only. Image content blocks (e.g. from the screenshot tool)
 * are replaced with a placeholder rather than forwarded, since most local models used with
 * this provider are text-only.
 */

export interface OpenAiCompatibleConfig {
	baseUrl: string;
	apiKey?: string;
	model: string;
}

export interface OpenAiCompatibleGatewayHandle {
	url: string;
	close(): Promise< void >;
}

const DEFAULT_CONTEXT_WINDOW = 8192;
const DEFAULT_MAX_TOKENS_RESERVE = 1024;
const SAFETY_MARGIN_TOKENS = 500;
const SUMMARY_RESERVE_TOKENS = 800;
const SUMMARY_MAX_TOKENS = 500;
const CHARS_PER_TOKEN_ESTIMATE = 4;

interface AnthropicTextBlock {
	type: 'text';
	text: string;
}

interface AnthropicImageBlock {
	type: 'image';
	source?: { type: string; media_type?: string; data?: string };
}

export interface AnthropicToolUseBlock {
	type: 'tool_use';
	id: string;
	name: string;
	input: unknown;
}

export interface AnthropicToolResultBlock {
	type: 'tool_result';
	tool_use_id: string;
	content?: string | Array< AnthropicTextBlock | AnthropicImageBlock >;
	is_error?: boolean;
}

type AnthropicContentBlock =
	| AnthropicTextBlock
	| AnthropicImageBlock
	| AnthropicToolUseBlock
	| AnthropicToolResultBlock;

export interface AnthropicMessage {
	role: 'user' | 'assistant';
	content: string | AnthropicContentBlock[];
}

interface AnthropicTool {
	name: string;
	description?: string;
	input_schema: Record< string, unknown >;
}

interface AnthropicToolChoice {
	type: 'auto' | 'any' | 'tool' | 'none';
	name?: string;
}

export interface AnthropicMessagesRequest {
	model: string;
	max_tokens?: number;
	system?: string | Array< { type: 'text'; text: string } >;
	messages: AnthropicMessage[];
	tools?: AnthropicTool[];
	tool_choice?: AnthropicToolChoice;
	stream?: boolean;
	temperature?: number;
}

interface OpenAiToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

interface OpenAiMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | null;
	tool_calls?: OpenAiToolCall[];
	tool_call_id?: string;
}

interface OpenAiChatRequest {
	model: string;
	messages: OpenAiMessage[];
	tools?: Array< {
		type: 'function';
		function: { name: string; description?: string; parameters: Record< string, unknown > };
	} >;
	tool_choice?: 'auto' | 'required' | 'none' | { type: 'function'; function: { name: string } };
	stream?: boolean;
	max_tokens?: number;
	temperature?: number;
}

export interface CompactionState {
	coveredMessages: AnthropicMessage[];
	summary: string;
}

export interface GatewayState {
	contextWindow: number;
	compaction?: CompactionState;
}

let activeGateway:
	| {
			handle: OpenAiCompatibleGatewayHandle;
			config: OpenAiCompatibleConfig;
			state: GatewayState;
	  }
	| undefined;

/**
 * Starts (or reuses) a local translation gateway for the given target config. Only one
 * gateway runs at a time; if the config changes, the previous gateway is closed first.
 */
export async function ensureOpenAiCompatibleGateway(
	config: OpenAiCompatibleConfig
): Promise< OpenAiCompatibleGatewayHandle > {
	if ( activeGateway && configsMatch( activeGateway.config, config ) ) {
		return activeGateway.handle;
	}

	if ( activeGateway ) {
		await activeGateway.handle.close();
		activeGateway = undefined;
	}

	const state: GatewayState = { contextWindow: await discoverContextWindow( config ) };
	const handle = await startOpenAiCompatibleGateway( config, state );
	activeGateway = { handle, config, state };
	return handle;
}

export async function discoverContextWindow( config: OpenAiCompatibleConfig ): Promise< number > {
	try {
		const response = await fetch( joinUrl( config.baseUrl, '/models' ), {
			headers: config.apiKey ? { authorization: `Bearer ${ config.apiKey }` } : {},
			signal: AbortSignal.timeout( 3000 ),
		} );
		if ( ! response.ok ) {
			return DEFAULT_CONTEXT_WINDOW;
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const body: any = await response.json();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const entry = ( body?.data ?? [] ).find( ( model: any ) => model?.id === config.model );
		const contextWindow =
			entry?.context_window ?? entry?.max_model_len ?? entry?.max_context_length;
		return typeof contextWindow === 'number' && contextWindow > 0
			? contextWindow
			: DEFAULT_CONTEXT_WINDOW;
	} catch {
		return DEFAULT_CONTEXT_WINDOW;
	}
}

function configsMatch( a: OpenAiCompatibleConfig, b: OpenAiCompatibleConfig ): boolean {
	return a.baseUrl === b.baseUrl && a.apiKey === b.apiKey && a.model === b.model;
}

function startOpenAiCompatibleGateway(
	config: OpenAiCompatibleConfig,
	state: GatewayState
): Promise< OpenAiCompatibleGatewayHandle > {
	return new Promise( ( resolve, reject ) => {
		const server = http.createServer( ( req, res ) => {
			handleRequest( req, res, config, state ).catch( ( error ) => {
				if ( ! res.headersSent ) {
					res.writeHead( 502, { 'content-type': 'application/json' } );
					res.end(
						JSON.stringify( {
							type: 'error',
							error: { type: 'api_error', message: getErrorMessage( error ) },
						} )
					);
					return;
				}
				res.end();
			} );
		} );

		server.once( 'error', reject );
		server.listen( 0, '127.0.0.1', () => {
			const address = server.address();
			if ( ! address || typeof address === 'string' ) {
				reject( new Error( 'Failed to determine local gateway port' ) );
				return;
			}

			resolve( {
				url: `http://127.0.0.1:${ address.port }`,
				close: () =>
					new Promise< void >( ( closeResolve ) => server.close( () => closeResolve() ) ),
			} );
		} );
	} );
}

async function handleRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	config: OpenAiCompatibleConfig,
	state: GatewayState
): Promise< void > {
	if ( req.method !== 'POST' || ! req.url?.startsWith( '/v1/messages' ) ) {
		res.writeHead( 404 ).end();
		return;
	}

	const rawBody = await readRequestBody( req );
	const parsedRequest = JSON.parse( rawBody ) as AnthropicMessagesRequest;
	const anthropicRequest = await compactMessagesIfNeeded( parsedRequest, config, state );
	const openAiRequest = toOpenAiChatRequest( anthropicRequest, config );

	const upstream = await fetch( joinUrl( config.baseUrl, '/chat/completions' ), {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...( config.apiKey ? { authorization: `Bearer ${ config.apiKey }` } : {} ),
		},
		body: JSON.stringify( openAiRequest ),
	} );

	if ( ! upstream.ok || ! upstream.body ) {
		const text = await upstream.text().catch( () => upstream.statusText );
		throw new Error( `Local model server returned ${ upstream.status }: ${ text }` );
	}

	if ( anthropicRequest.stream ) {
		res.writeHead( 200, {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive',
		} );
		await streamOpenAiToAnthropic( upstream.body, res, anthropicRequest.model );
		res.end();
		return;
	}

	const openAiResponse = await upstream.json();
	const anthropicMessage = fromOpenAiCompletion( openAiResponse, anthropicRequest.model );
	res.writeHead( 200, { 'content-type': 'application/json' } );
	res.end( JSON.stringify( anthropicMessage ) );
}

function readRequestBody( req: http.IncomingMessage ): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		const chunks: Buffer[] = [];
		req.on( 'data', ( chunk ) => chunks.push( chunk ) );
		req.on( 'end', () => resolve( Buffer.concat( chunks ).toString( 'utf8' ) ) );
		req.on( 'error', reject );
	} );
}

function joinUrl( base: string, pathname: string ): string {
	return `${ base.replace( /\/+$/, '' ) }${ pathname }`;
}

function getErrorMessage( error: unknown ): string {
	return error instanceof Error ? error.message : String( error );
}

function blockToText( block: AnthropicTextBlock | AnthropicImageBlock ): string {
	if ( block.type === 'text' ) {
		return block.text;
	}
	return '[image omitted: this model does not support image input]';
}

function toolResultContentToString( content: AnthropicToolResultBlock[ 'content' ] ): string {
	if ( content === undefined ) {
		return '';
	}
	if ( typeof content === 'string' ) {
		return content;
	}
	return content.map( blockToText ).join( '\n' );
}

function toOpenAiToolChoice(
	toolChoice: AnthropicToolChoice | undefined
): OpenAiChatRequest[ 'tool_choice' ] {
	if ( ! toolChoice ) {
		return undefined;
	}
	if ( toolChoice.type === 'any' ) {
		return 'required';
	}
	if ( toolChoice.type === 'tool' && toolChoice.name ) {
		return { type: 'function', function: { name: toolChoice.name } };
	}
	if ( toolChoice.type === 'none' ) {
		return 'none';
	}
	return 'auto';
}

function estimateTokens( text: string ): number {
	return Math.ceil( text.length / CHARS_PER_TOKEN_ESTIMATE );
}

function messageBlocks( message: AnthropicMessage ): AnthropicContentBlock[] {
	return typeof message.content === 'string'
		? [ { type: 'text', text: message.content } ]
		: message.content;
}

function estimateMessageTokens( message: AnthropicMessage ): number {
	const serialized = messageBlocks( message )
		.map( ( block ) => {
			if ( block.type === 'text' ) {
				return block.text;
			}
			if ( block.type === 'image' ) {
				return '[image]';
			}
			if ( block.type === 'tool_use' ) {
				return JSON.stringify( block.input ?? {} );
			}
			return toolResultContentToString( block.content );
		} )
		.join( '\n' );
	return estimateTokens( serialized ) + 4;
}

export function estimateRequestTokens( request: AnthropicMessagesRequest ): number {
	const systemText = Array.isArray( request.system )
		? request.system.map( ( block ) => block.text ).join( '\n' )
		: request.system ?? '';
	const toolsTokens = request.tools ? estimateTokens( JSON.stringify( request.tools ) ) : 0;
	const messagesTokens = request.messages.reduce(
		( sum, message ) => sum + estimateMessageTokens( message ),
		0
	);
	return estimateTokens( systemText ) + toolsTokens + messagesTokens;
}

function messageToolUseIds( message: AnthropicMessage ): string[] {
	return messageBlocks( message )
		.filter( ( block ): block is AnthropicToolUseBlock => block.type === 'tool_use' )
		.map( ( block ) => block.id );
}

function messageToolResultIds( message: AnthropicMessage ): string[] {
	return messageBlocks( message )
		.filter( ( block ): block is AnthropicToolResultBlock => block.type === 'tool_result' )
		.map( ( block ) => block.tool_use_id );
}

/**
 * Finds the largest suffix of `messages` whose estimated token count fits within
 * `recentBudget`, then extends it backward as needed so a `tool_use` message is never
 * separated from the `tool_result` message that answers it.
 */
export function findSplitIndex( messages: AnthropicMessage[], recentBudget: number ): number {
	let accumulated = 0;
	let splitIndex = messages.length;
	for ( let i = messages.length - 1; i >= 0; i-- ) {
		const tokens = estimateMessageTokens( messages[ i ] );
		if ( accumulated + tokens > recentBudget ) {
			break;
		}
		accumulated += tokens;
		splitIndex = i;
	}
	return stabilizeSplitIndex( messages, splitIndex );
}

function stabilizeSplitIndex( messages: AnthropicMessage[], splitIndex: number ): number {
	let index = splitIndex;
	let changed = true;
	while ( changed && index > 0 ) {
		changed = false;
		const resultIds = new Set( messages.slice( index ).flatMap( messageToolResultIds ) );
		const precedingToolUseIds = messageToolUseIds( messages[ index - 1 ] );
		if ( precedingToolUseIds.some( ( id ) => resultIds.has( id ) ) ) {
			index -= 1;
			changed = true;
		}
	}
	return index;
}

function messagesEqual( a: AnthropicMessage, b: AnthropicMessage ): boolean {
	return JSON.stringify( a ) === JSON.stringify( b );
}

function isPrefixOf( prefix: AnthropicMessage[], full: AnthropicMessage[] ): boolean {
	if ( prefix.length > full.length ) {
		return false;
	}
	return prefix.every( ( message, index ) => messagesEqual( message, full[ index ] ) );
}

function serializeMessageForSummary( message: AnthropicMessage ): string {
	const parts = messageBlocks( message ).map( ( block ) => {
		if ( block.type === 'text' ) {
			return block.text;
		}
		if ( block.type === 'image' ) {
			return '[image omitted]';
		}
		if ( block.type === 'tool_use' ) {
			return `Called ${ block.name } with ${ JSON.stringify( block.input ?? {} ) }`;
		}
		return `Result: ${ toolResultContentToString( block.content ) }`;
	} );
	return `${ message.role }: ${ parts.join( '\n' ) }`;
}

async function summarizeConversation(
	messages: AnthropicMessage[],
	config: OpenAiCompatibleConfig,
	previousSummary?: string
): Promise< string > {
	const fallback = previousSummary ?? '[Unable to summarize earlier conversation]';
	const transcript = messages.map( serializeMessageForSummary ).join( '\n\n' );
	const instruction = previousSummary
		? `Here is a summary of earlier conversation:\n${ previousSummary }\n\nUpdate this summary to also incorporate the following additional conversation, staying concise and preserving key facts and decisions:\n\n${ transcript }`
		: `Summarize the following conversation concisely, preserving key facts and decisions:\n\n${ transcript }`;

	try {
		const response = await fetch( joinUrl( config.baseUrl, '/chat/completions' ), {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...( config.apiKey ? { authorization: `Bearer ${ config.apiKey }` } : {} ),
			},
			body: JSON.stringify( {
				model: config.model,
				stream: false,
				max_tokens: SUMMARY_MAX_TOKENS,
				temperature: 0.2,
				messages: [
					{ role: 'system', content: 'You summarize conversations concisely and factually.' },
					{ role: 'user', content: instruction },
				],
			} ),
		} );

		if ( ! response.ok ) {
			return fallback;
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const body: any = await response.json();
		const summary = body?.choices?.[ 0 ]?.message?.content;
		return typeof summary === 'string' && summary.trim().length > 0 ? summary.trim() : fallback;
	} catch {
		return fallback;
	}
}

async function resolveSummary(
	oldChunk: AnthropicMessage[],
	config: OpenAiCompatibleConfig,
	state: GatewayState
): Promise< string > {
	const existing = state.compaction;

	if ( existing && isPrefixOf( existing.coveredMessages, oldChunk ) ) {
		if ( existing.coveredMessages.length === oldChunk.length ) {
			return existing.summary;
		}
		const newPortion = oldChunk.slice( existing.coveredMessages.length );
		const summary = await summarizeConversation( newPortion, config, existing.summary );
		state.compaction = { coveredMessages: oldChunk, summary };
		return summary;
	}

	const summary = await summarizeConversation( oldChunk, config );
	state.compaction = { coveredMessages: oldChunk, summary };
	return summary;
}

/**
 * Shrinks an over-budget conversation to fit the local model's discovered context window by
 * summarizing the oldest messages into the system prompt and keeping the recent tail verbatim.
 * A `tool_use`/`tool_result` pair is never split across the boundary.
 */
export async function compactMessagesIfNeeded(
	request: AnthropicMessagesRequest,
	config: OpenAiCompatibleConfig,
	state: GatewayState
): Promise< AnthropicMessagesRequest > {
	const budget =
		state.contextWindow -
		( request.max_tokens ?? DEFAULT_MAX_TOKENS_RESERVE ) -
		SAFETY_MARGIN_TOKENS;
	if ( estimateRequestTokens( request ) <= budget ) {
		return request;
	}

	const recentBudget = budget - SUMMARY_RESERVE_TOKENS;
	const splitIndex = findSplitIndex( request.messages, recentBudget );
	if ( splitIndex <= 0 ) {
		return request;
	}

	const oldChunk = request.messages.slice( 0, splitIndex );
	const recentTail = request.messages.slice( splitIndex );
	const summary = await resolveSummary( oldChunk, config, state );

	const systemText = Array.isArray( request.system )
		? request.system.map( ( block ) => block.text ).join( '\n' )
		: request.system ?? '';
	const compactedSystem = `${ systemText }\n\n[Summary of earlier conversation, condensed to fit the local model's context window]\n${ summary }`;

	return { ...request, system: compactedSystem, messages: recentTail };
}

function toOpenAiChatRequest(
	anthropicRequest: AnthropicMessagesRequest,
	config: OpenAiCompatibleConfig
): OpenAiChatRequest {
	const messages: OpenAiMessage[] = [];

	const systemText = Array.isArray( anthropicRequest.system )
		? anthropicRequest.system.map( ( block ) => block.text ).join( '\n' )
		: anthropicRequest.system;
	if ( systemText ) {
		messages.push( { role: 'system', content: systemText } );
	}

	for ( const message of anthropicRequest.messages ) {
		const blocks: AnthropicContentBlock[] =
			typeof message.content === 'string'
				? [ { type: 'text', text: message.content } ]
				: message.content;

		const toolResultBlocks = blocks.filter(
			( block ): block is AnthropicToolResultBlock => block.type === 'tool_result'
		);
		if ( toolResultBlocks.length > 0 ) {
			for ( const block of toolResultBlocks ) {
				messages.push( {
					role: 'tool',
					tool_call_id: block.tool_use_id,
					content: toolResultContentToString( block.content ),
				} );
			}
			continue;
		}

		const toolUseBlocks = blocks.filter(
			( block ): block is AnthropicToolUseBlock => block.type === 'tool_use'
		);
		const textBlocks = blocks.filter(
			( block ): block is AnthropicTextBlock | AnthropicImageBlock =>
				block.type === 'text' || block.type === 'image'
		);
		const text = textBlocks.map( blockToText ).join( '\n' );

		if ( toolUseBlocks.length > 0 ) {
			messages.push( {
				role: 'assistant',
				content: text.length > 0 ? text : null,
				tool_calls: toolUseBlocks.map( ( block ) => ( {
					id: block.id,
					type: 'function' as const,
					function: {
						name: block.name,
						arguments: JSON.stringify( block.input ?? {} ),
					},
				} ) ),
			} );
			continue;
		}

		messages.push( { role: message.role, content: text } );
	}

	const tools = anthropicRequest.tools?.map( ( tool ) => ( {
		type: 'function' as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.input_schema,
		},
	} ) );

	const toolChoice = toOpenAiToolChoice( anthropicRequest.tool_choice );

	return {
		model: config.model,
		messages,
		...( tools && tools.length > 0 ? { tools } : {} ),
		...( toolChoice ? { tool_choice: toolChoice } : {} ),
		stream: Boolean( anthropicRequest.stream ),
		max_tokens: anthropicRequest.max_tokens,
		temperature: anthropicRequest.temperature,
	};
}

function mapFinishReason( reason: string | null | undefined ): string {
	switch ( reason ) {
		case 'tool_calls':
			return 'tool_use';
		case 'length':
			return 'max_tokens';
		default:
			return 'end_turn';
	}
}

function safeJsonParse( json: string ): unknown {
	try {
		return JSON.parse( json );
	} catch {
		return {};
	}
}

function fromOpenAiCompletion(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	openAiResponse: any,
	model: string
): Record< string, unknown > {
	const choice = openAiResponse.choices?.[ 0 ];
	const message = choice?.message ?? {};
	const content: Array< Record< string, unknown > > = [];

	if ( message.content ) {
		content.push( { type: 'text', text: message.content } );
	}
	for ( const toolCall of message.tool_calls ?? [] ) {
		content.push( {
			type: 'tool_use',
			id: toolCall.id,
			name: toolCall.function.name,
			input: safeJsonParse( toolCall.function.arguments ),
		} );
	}

	return {
		id: openAiResponse.id ?? `msg_${ randomUUID() }`,
		type: 'message',
		role: 'assistant',
		model,
		content,
		stop_reason: mapFinishReason( choice?.finish_reason ),
		stop_sequence: null,
		usage: {
			input_tokens: openAiResponse.usage?.prompt_tokens ?? 0,
			output_tokens: openAiResponse.usage?.completion_tokens ?? 0,
		},
	};
}

async function streamOpenAiToAnthropic(
	body: ReadableStream< Uint8Array >,
	res: http.ServerResponse,
	model: string
): Promise< void > {
	const messageId = `msg_${ randomUUID() }`;
	let sentMessageStart = false;
	let textBlockIndex: number | null = null;
	let textOpen = false;
	const toolBlocksByOpenAiIndex = new Map< number, { anthropicIndex: number; id: string } >();
	let nextBlockIndex = 0;
	let finishReason: string | null = null;
	let outputTokens = 0;

	const send = ( event: string, data: unknown ) => {
		res.write( `event: ${ event }\ndata: ${ JSON.stringify( data ) }\n\n` );
	};

	const ensureMessageStart = () => {
		if ( sentMessageStart ) {
			return;
		}
		sentMessageStart = true;
		send( 'message_start', {
			type: 'message_start',
			message: {
				id: messageId,
				type: 'message',
				role: 'assistant',
				model,
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: 0, output_tokens: 0 },
			},
		} );
	};

	const closeTextBlockIfOpen = () => {
		if ( textOpen ) {
			send( 'content_block_stop', { type: 'content_block_stop', index: textBlockIndex } );
			textOpen = false;
		}
	};

	const ensureTextBlock = (): number => {
		ensureMessageStart();
		if ( textOpen ) {
			return textBlockIndex as number;
		}
		textBlockIndex = nextBlockIndex++;
		textOpen = true;
		send( 'content_block_start', {
			type: 'content_block_start',
			index: textBlockIndex,
			content_block: { type: 'text', text: '' },
		} );
		return textBlockIndex;
	};

	const ensureToolBlock = (
		openAiIndex: number,
		id: string | undefined,
		name: string | undefined
	): { anthropicIndex: number; id: string } => {
		ensureMessageStart();
		const existing = toolBlocksByOpenAiIndex.get( openAiIndex );
		if ( existing ) {
			return existing;
		}
		closeTextBlockIfOpen();
		const anthropicIndex = nextBlockIndex++;
		const entry = { anthropicIndex, id: id ?? `toolu_${ randomUUID() }` };
		toolBlocksByOpenAiIndex.set( openAiIndex, entry );
		send( 'content_block_start', {
			type: 'content_block_start',
			index: anthropicIndex,
			content_block: { type: 'tool_use', id: entry.id, name: name ?? '', input: {} },
		} );
		return entry;
	};

	const processSseEvent = ( rawEvent: string ) => {
		const dataLine = rawEvent.split( '\n' ).find( ( line ) => line.startsWith( 'data:' ) );
		if ( ! dataLine ) {
			return;
		}
		const payload = dataLine.slice( 'data:'.length ).trim();
		if ( ! payload || payload === '[DONE]' ) {
			return;
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let parsed: any;
		try {
			parsed = JSON.parse( payload );
		} catch {
			return;
		}

		if ( typeof parsed.usage?.completion_tokens === 'number' ) {
			outputTokens = parsed.usage.completion_tokens;
		}

		const choice = parsed.choices?.[ 0 ];
		if ( ! choice ) {
			return;
		}

		const delta = choice.delta ?? {};

		if ( typeof delta.content === 'string' && delta.content.length > 0 ) {
			const index = ensureTextBlock();
			send( 'content_block_delta', {
				type: 'content_block_delta',
				index,
				delta: { type: 'text_delta', text: delta.content },
			} );
		}

		for ( const toolCallDelta of delta.tool_calls ?? [] ) {
			const entry = ensureToolBlock(
				toolCallDelta.index ?? 0,
				toolCallDelta.id,
				toolCallDelta.function?.name
			);
			if ( toolCallDelta.function?.arguments ) {
				send( 'content_block_delta', {
					type: 'content_block_delta',
					index: entry.anthropicIndex,
					delta: { type: 'input_json_delta', partial_json: toolCallDelta.function.arguments },
				} );
			}
		}

		if ( choice.finish_reason ) {
			finishReason = choice.finish_reason;
		}
	};

	let buffer = '';
	for await ( const chunk of Readable.fromWeb( body as never ) ) {
		buffer += ( chunk as Buffer ).toString( 'utf8' );
		let separatorIndex: number;
		while ( ( separatorIndex = buffer.indexOf( '\n\n' ) ) !== -1 ) {
			const rawEvent = buffer.slice( 0, separatorIndex );
			buffer = buffer.slice( separatorIndex + 2 );
			processSseEvent( rawEvent );
		}
	}

	closeTextBlockIfOpen();
	for ( const entry of toolBlocksByOpenAiIndex.values() ) {
		send( 'content_block_stop', { type: 'content_block_stop', index: entry.anthropicIndex } );
	}

	ensureMessageStart();
	send( 'message_delta', {
		type: 'message_delta',
		delta: { stop_reason: mapFinishReason( finishReason ), stop_sequence: null },
		usage: { output_tokens: outputTokens },
	} );
	send( 'message_stop', { type: 'message_stop' } );
}
