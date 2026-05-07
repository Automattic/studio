import { describe, expect, it } from 'vitest';
import { parseStudioCodeEvent } from '../studio-code-event-parser';
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent';
import type { StudioCodeEvent } from 'src/modules/studio-code/studio-code-event-types';

const ts = '2026-05-06T00:00:00.000Z';

function envelope< T >( message: T ): StudioCodeEvent {
	return { type: 'message', timestamp: ts, message: message as AgentSessionEvent };
}

describe( 'parseStudioCodeEvent — pi event shapes', () => {
	it( 'maps pi `message_end` text blocks to APPEND_TEXT', () => {
		const event = envelope( {
			type: 'message_end',
			message: {
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Hello, ' },
					{ type: 'text', text: 'world!' },
				],
			},
		} );
		expect( parseStudioCodeEvent( event ) ).toEqual( [
			{ type: 'APPEND_TEXT', text: 'Hello, ' },
			{ type: 'APPEND_TEXT', text: 'world!' },
		] );
	} );

	it( 'maps pi `message_end` toolCall blocks to TOOL_USE_START', () => {
		const event = envelope( {
			type: 'message_end',
			message: {
				role: 'assistant',
				content: [
					{
						type: 'toolCall',
						id: 'call_1',
						name: 'Read',
						arguments: { path: '/tmp/foo' },
					},
				],
			},
		} );
		expect( parseStudioCodeEvent( event ) ).toEqual( [
			{
				type: 'TOOL_USE_START',
				id: 'call_1',
				name: 'Read',
				input: { path: '/tmp/foo' },
			},
		] );
	} );

	it( 'ignores `message_end` for non-assistant messages', () => {
		const event = envelope( {
			type: 'message_end',
			message: { role: 'user', content: 'hi' },
		} );
		expect( parseStudioCodeEvent( event ) ).toEqual( [] );
	} );

	it( 'maps pi `turn_end` toolResults to TOOL_RESULT (text + error flag)', () => {
		const event = envelope( {
			type: 'turn_end',
			toolResults: [
				{
					role: 'toolResult',
					toolCallId: 'call_1',
					content: [ { type: 'text', text: 'ok' } ],
					isError: false,
				},
				{
					role: 'toolResult',
					toolCallId: 'call_2',
					content: [ { type: 'text', text: 'boom' } ],
					isError: true,
				},
			],
		} );
		expect( parseStudioCodeEvent( event ) ).toEqual( [
			{ type: 'TOOL_RESULT', id: 'call_1', output: 'ok', isError: false },
			{ type: 'TOOL_RESULT', id: 'call_2', output: 'boom', isError: true },
		] );
	} );

	it( 'returns [] for non-message-bearing pi events (agent_end, turn_start, …)', () => {
		expect( parseStudioCodeEvent( envelope( { type: 'agent_end', messages: [] } ) ) ).toEqual( [] );
		expect( parseStudioCodeEvent( envelope( { type: 'turn_start' } ) ) ).toEqual( [] );
	} );
} );

describe( 'parseStudioCodeEvent — envelope-level events', () => {
	it( 'maps `turn.started` to START_ASSISTANT_MESSAGE', () => {
		expect( parseStudioCodeEvent( { type: 'turn.started', timestamp: ts } ) ).toEqual( [
			{ type: 'START_ASSISTANT_MESSAGE' },
		] );
	} );

	it( 'maps `turn.completed` to TURN_COMPLETE', () => {
		expect(
			parseStudioCodeEvent( {
				type: 'turn.completed',
				timestamp: ts,
				sessionId: 'sess-1',
				status: 'success',
			} )
		).toEqual( [ { type: 'TURN_COMPLETE', sessionId: 'sess-1', status: 'success' } ] );
	} );

	it( 'maps `progress` and `error` to SET_PROGRESS and ERROR', () => {
		expect(
			parseStudioCodeEvent( { type: 'progress', timestamp: ts, message: 'reading' } )
		).toEqual( [ { type: 'SET_PROGRESS', message: 'reading' } ] );

		expect( parseStudioCodeEvent( { type: 'error', timestamp: ts, message: 'oops' } ) ).toEqual( [
			{ type: 'ERROR', message: 'oops' },
		] );
	} );
} );
