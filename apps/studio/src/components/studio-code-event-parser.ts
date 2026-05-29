import type { PermissionRequest } from './studio-code-ui-types';
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent';
import type { StudioCodeEvent } from 'src/modules/studio-code/studio-code-event-types';

// Translates the CLI's NDJSON wire format into reducer actions for
// `studio-code-chat`. The CLI wraps native pi `AgentSessionEvent` payloads
// inside the `{type:'message', message: <event>}` envelope, so this parser
// pattern-matches against pi event shapes (`message_end`, `turn_end`). The
// other envelope-level event types (`turn.started`, `turn.completed`,
// `question.asked`, `progress`, `error`) come straight from `JsonAdapter.emit*`.

interface PiTextContent {
	type: 'text';
	text: string;
}
interface PiToolCallContent {
	type: 'toolCall';
	id: string;
	name: string;
	arguments?: Record< string, unknown >;
}
type PiAssistantContent = PiTextContent | PiToolCallContent | { type: string };

interface PiAssistantMessage {
	role: 'assistant';
	content: PiAssistantContent[];
	stopReason?: string;
}

interface PiToolResultMessage {
	role: 'toolResult';
	toolCallId: string;
	toolName?: string;
	content?: Array< { type: string; text?: string } > | string;
	isError?: boolean;
}

interface PiTurnEndEvent {
	type: 'turn_end';
	toolResults?: PiToolResultMessage[];
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

function toolResultText( content: PiToolResultMessage[ 'content' ] ): string {
	if ( typeof content === 'string' ) return content;
	if ( ! Array.isArray( content ) ) return '';
	return content
		.filter( ( c ) => c.type === 'text' && typeof c.text === 'string' )
		.map( ( c ) => c.text as string )
		.join( '\n' );
}

function parseSessionMessage( event: AgentSessionEvent ): ParsedAction[] {
	if ( event.type === 'message_end' ) {
		const message = event.message as PiAssistantMessage | { role?: string };
		if ( message.role !== 'assistant' ) return [];
		const actions: ParsedAction[] = [];
		for ( const block of ( message as PiAssistantMessage ).content ?? [] ) {
			if ( block.type === 'text' ) {
				const text = ( block as PiTextContent ).text;
				if ( text ) actions.push( { type: 'APPEND_TEXT', text } );
			} else if ( block.type === 'toolCall' ) {
				const tc = block as PiToolCallContent;
				actions.push( {
					type: 'TOOL_USE_START',
					id: tc.id,
					name: tc.name,
					input: tc.arguments ?? {},
				} );
			}
			// Thinking blocks and other content types are intentionally ignored
			// — the chat surfaces user-visible text + tool calls only.
		}
		return actions;
	}

	if ( event.type === 'turn_end' ) {
		const results = ( event as PiTurnEndEvent ).toolResults ?? [];
		return results.map( ( tr ) => ( {
			type: 'TOOL_RESULT' as const,
			id: tr.toolCallId,
			output: toolResultText( tr.content ),
			isError: tr.isError === true,
		} ) );
	}

	return [];
}

export function parseStudioCodeEvent( event: StudioCodeEvent ): ParsedAction[] {
	switch ( event.type ) {
		case 'message':
			return parseSessionMessage( event.message );

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
