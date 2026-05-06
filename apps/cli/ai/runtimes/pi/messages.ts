// Translates between pi-agent-core's in-memory `AgentMessage`s and the
// legacy `sdk.message` events stored on disk (`AiSessionEvent[]`). The CLI
// is the only place this bridge runs — disk format is the legacy session
// JSONL (unchanged from before the pi adoption); pi messages live only in
// the agent's in-memory state.

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { AssistantMessage, ToolResultMessage, UserMessage } from '@mariozechner/pi-ai';
import type { AiSessionEvent } from '@studio/common/ai/sessions/types';

interface LegacySdkContent {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	input?: Record< string, unknown >;
	tool_use_id?: string;
	content?: string | Array< { type: string; text?: string } >;
	is_error?: boolean;
}

interface LegacySdkMessage {
	type?: string;
	parent_tool_use_id?: string | null;
	uuid?: string;
	session_id?: string;
	error?: unknown;
	message?: {
		role?: string;
		content?: LegacySdkContent[];
		model?: string;
	};
}

function toUserMessage( msg: LegacySdkMessage ): UserMessage | ToolResultMessage | null {
	const content = msg.message?.content;
	if ( ! Array.isArray( content ) ) return null;
	const toolResultBlock = content.find( ( b ) => b && b.type === 'tool_result' );
	if ( toolResultBlock ) {
		const text =
			typeof toolResultBlock.content === 'string'
				? [ { type: 'text' as const, text: toolResultBlock.content } ]
				: Array.isArray( toolResultBlock.content )
				? toolResultBlock.content
						.filter( ( b ) => b.type === 'text' && typeof b.text === 'string' )
						.map( ( b ) => ( { type: 'text' as const, text: b.text as string } ) )
				: [];
		return {
			role: 'toolResult',
			toolCallId: toolResultBlock.tool_use_id ?? '',
			toolName: 'unknown',
			content: text,
			isError: toolResultBlock.is_error === true,
			timestamp: Date.now(),
		};
	}
	return null;
}

function toAssistantMessage( msg: LegacySdkMessage ): AssistantMessage | null {
	const content = msg.message?.content;
	if ( ! Array.isArray( content ) ) return null;
	const blocks: AssistantMessage[ 'content' ] = [];
	for ( const block of content ) {
		if ( block.type === 'text' && typeof block.text === 'string' ) {
			blocks.push( { type: 'text', text: block.text } );
		} else if (
			block.type === 'tool_use' &&
			typeof block.id === 'string' &&
			typeof block.name === 'string'
		) {
			blocks.push( {
				type: 'toolCall',
				id: block.id,
				name: block.name,
				arguments: block.input ?? {},
			} );
		}
	}
	return {
		role: 'assistant',
		content: blocks,
		api: 'anthropic-messages',
		provider: 'anthropic',
		model: msg.message?.model ?? '',
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: 'stop',
		timestamp: Date.now(),
	};
}

// Reads legacy session events and returns the pi `AgentMessage[]` the agent
// loop expects when hydrating mid-session. Anything that isn't a stored
// `sdk.message` (i.e. studio-side metadata events) is filtered out — the
// agent doesn't consume those.
export function legacyEventsToAgentMessages( events: AiSessionEvent[] ): AgentMessage[] {
	const out: AgentMessage[] = [];
	const toolNameById = new Map< string, string >();

	for ( const event of events ) {
		if ( event.type === 'user.message' && event.source === 'prompt' ) {
			out.push( {
				role: 'user',
				content: event.text,
				timestamp: Date.parse( event.timestamp ) || Date.now(),
			} );
			continue;
		}

		if ( event.type !== 'sdk.message' ) continue;
		const msg = event.message as LegacySdkMessage;
		if ( ! msg || typeof msg !== 'object' ) continue;

		if ( msg.type === 'assistant' ) {
			const assistant = toAssistantMessage( msg );
			if ( ! assistant ) continue;
			for ( const block of assistant.content ) {
				if ( block.type === 'toolCall' ) toolNameById.set( block.id, block.name );
			}
			out.push( assistant );
		} else if ( msg.type === 'user' ) {
			const result = toUserMessage( msg );
			if ( result && result.role === 'toolResult' ) {
				result.toolName = toolNameById.get( result.toolCallId ) ?? 'unknown';
				out.push( result );
			}
		}
	}

	return out;
}

// Converts a pi assistant message into the legacy `sdk.message` event shape.
// Used by the runtime to persist new turns to disk.
export function assistantMessageToLegacyEvent(
	message: AssistantMessage,
	sessionId: string,
	timestamp: string
): AiSessionEvent {
	const content: LegacySdkContent[] = [];
	for ( const block of message.content ) {
		if ( block.type === 'text' ) {
			content.push( { type: 'text', text: block.text } );
		} else if ( block.type === 'toolCall' ) {
			content.push( {
				type: 'tool_use',
				id: block.id,
				name: block.name,
				input: block.arguments as Record< string, unknown >,
			} );
		}
	}
	return {
		type: 'sdk.message',
		timestamp,
		message: {
			type: 'assistant',
			parent_tool_use_id: null,
			uuid: '',
			session_id: sessionId,
			error: message.stopReason === 'error' ? message.errorMessage ?? 'unknown' : undefined,
			message: {
				type: 'message',
				role: 'assistant',
				model: message.model,
				content,
				stop_reason: message.stopReason,
				stop_sequence: null,
				usage: {
					input_tokens: 0,
					output_tokens: 0,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
					service_tier: 'standard',
				},
			},
		},
	} as unknown as AiSessionEvent;
}

// Converts a pi tool-result message into the legacy `sdk.message` (user-side
// tool_result block) event shape.
export function toolResultMessageToLegacyEvent(
	message: ToolResultMessage,
	sessionId: string,
	timestamp: string
): AiSessionEvent {
	const text = message.content
		.filter( ( b ) => b.type === 'text' )
		.map( ( b ) => ( b as { type: 'text'; text: string } ).text )
		.join( '' );
	return {
		type: 'sdk.message',
		timestamp,
		message: {
			type: 'user',
			parent_tool_use_id: message.toolCallId,
			uuid: '',
			session_id: sessionId,
			message: {
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: message.toolCallId,
						content: text,
						is_error: message.isError,
					},
				],
			},
		},
	} as unknown as AiSessionEvent;
}
