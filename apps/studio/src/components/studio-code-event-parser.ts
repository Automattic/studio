import type { PermissionRequest } from './studio-code-ui-types';
import type { StudioCodeEvent } from 'src/modules/studio-code/studio-code-event-types';

// Minimal shapes matching SDK types — avoids importing @anthropic-ai/claude-agent-sdk in the renderer.

interface ContentBlock {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	input?: Record< string, unknown >;
	content?: string | Array< { type: string; text?: string } >;
	is_error?: boolean;
	tool_use_id?: string;
}

// SDKAssistantMessage: { type: 'assistant', message: { content: ContentBlock[] }, ... }
// SDKUserMessage: { type: 'user', message: { content: ContentBlock[] | string }, ... }
// SDKResultMessage: { type: 'result', subtype: string, session_id: string, ... }
// SDKPartialAssistantMessage: { type: 'stream_event', event: { type, delta?, content_block? }, ... }
interface SdkMessage {
	type: string;
	subtype?: string;
	message?: {
		content?: ContentBlock[] | string;
	};
	session_id?: string;
	event?: {
		type: string;
		delta?: { type: string; text?: string };
		content_block?: {
			type: string;
			id?: string;
			name?: string;
			input?: Record< string, unknown >;
		};
	};
}

export type ParsedAction =
	| { type: 'START_ASSISTANT_MESSAGE' }
	| { type: 'APPEND_TEXT'; text: string }
	| { type: 'TOOL_USE_START'; id: string; name: string; input: Record< string, unknown > }
	| { type: 'TOOL_RESULT'; id: string; output: string; isError: boolean }
	| { type: 'TURN_COMPLETE'; sessionId: string; status: string }
	| { type: 'PERMISSION_REQUEST'; request: PermissionRequest }
	| { type: 'SET_PROGRESS'; message: string }
	| { type: 'ERROR'; message: string };

function parseContentBlocks( blocks: ContentBlock[], role: 'assistant' | 'user' ): ParsedAction[] {
	const actions: ParsedAction[] = [];
	for ( const block of blocks ) {
		if ( role === 'assistant' ) {
			if ( block.type === 'text' && block.text ) {
				actions.push( { type: 'APPEND_TEXT', text: block.text } );
			} else if ( block.type === 'tool_use' && block.id && block.name ) {
				actions.push( {
					type: 'TOOL_USE_START',
					id: block.id,
					name: block.name,
					input: ( block.input as Record< string, unknown > ) ?? {},
				} );
			}
		} else if ( role === 'user' ) {
			if ( block.type === 'tool_result' && block.tool_use_id ) {
				const outputText =
					typeof block.content === 'string'
						? block.content
						: Array.isArray( block.content )
						? block.content
								.filter( ( c ) => c.type === 'text' && c.text )
								.map( ( c ) => c.text )
								.join( '\n' )
						: '';
				actions.push( {
					type: 'TOOL_RESULT',
					id: block.tool_use_id,
					output: outputText,
					isError: block.is_error === true,
				} );
			}
		}
	}
	return actions;
}

function parseSdkMessage( raw: unknown ): ParsedAction[] {
	const message = raw as SdkMessage;

	switch ( message.type ) {
		case 'assistant': {
			// SDKAssistantMessage — complete message with content in message.message.content
			const content = message.message?.content;
			if ( ! content || ! Array.isArray( content ) ) {
				return [];
			}
			return parseContentBlocks( content as ContentBlock[], 'assistant' );
		}

		case 'stream_event': {
			// SDKPartialAssistantMessage — streaming text deltas
			const event = message.event;
			if ( ! event ) {
				return [];
			}
			if (
				event.type === 'content_block_delta' &&
				event.delta?.type === 'text_delta' &&
				event.delta.text
			) {
				return [ { type: 'APPEND_TEXT', text: event.delta.text } ];
			}
			return [];
		}

		case 'user': {
			// SDKUserMessage — tool results in message.message.content
			const content = message.message?.content;
			if ( ! content || ! Array.isArray( content ) ) {
				return [];
			}
			return parseContentBlocks( content as ContentBlock[], 'user' );
		}

		case 'result':
			return [
				{
					type: 'TURN_COMPLETE',
					sessionId: message.session_id ?? '',
					status: message.subtype === 'success' ? 'success' : 'error',
				},
			];

		default:
			return [];
	}
}

export function parseStudioCodeEvent( event: StudioCodeEvent ): ParsedAction[] {
	switch ( event.type ) {
		case 'message':
			return parseSdkMessage( event.message );

		case 'turn.started':
			return [ { type: 'START_ASSISTANT_MESSAGE' } ];

		case 'turn.completed':
			return [
				{
					type: 'TURN_COMPLETE',
					sessionId: event.sessionId,
					status: event.status,
				},
			];

		case 'question.asked':
			return event.questions.map( ( q ) => ( {
				type: 'PERMISSION_REQUEST' as const,
				request: {
					id: crypto.randomUUID(),
					question: q.question,
					options: q.options.map( ( o ) => o.label ),
				},
			} ) );

		case 'progress':
			return [ { type: 'SET_PROGRESS', message: event.message } ];

		case 'error':
			return [ { type: 'ERROR', message: event.message } ];

		default:
			return [];
	}
}
