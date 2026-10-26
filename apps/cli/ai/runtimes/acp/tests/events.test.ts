import { describe, expect, it } from 'vitest';
import { toSessionUpdates } from 'cli/ai/runtimes/acp/events';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

function messageUpdate( assistantMessageEvent: unknown ): AgentSessionEvent {
	return { type: 'message_update', assistantMessageEvent } as unknown as AgentSessionEvent;
}

describe( 'toSessionUpdates', () => {
	it( 'streams text and reasoning deltas as message and thought chunks', () => {
		expect( toSessionUpdates( messageUpdate( { type: 'text_delta', delta: 'Hello' } ) ) ).toEqual( [
			{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' } },
		] );
		expect( toSessionUpdates( messageUpdate( { type: 'thinking_delta', delta: 'Hmm' } ) ) ).toEqual(
			[ { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Hmm' } } ]
		);
	} );

	it( 'skips empty deltas and turn bookkeeping', () => {
		expect( toSessionUpdates( messageUpdate( { type: 'text_delta', delta: '' } ) ) ).toEqual( [] );
		expect( toSessionUpdates( { type: 'agent_start' } as AgentSessionEvent ) ).toEqual( [] );
		expect( toSessionUpdates( { type: 'turn_start' } as AgentSessionEvent ) ).toEqual( [] );
	} );

	it( 'opens a tool call with its Studio label, kind, and file location', () => {
		const [ update ] = toSessionUpdates( {
			type: 'tool_execution_start',
			toolCallId: 'call-1',
			toolName: 'Read',
			args: { path: '/Users/me/Studio/site/style.css' },
		} as AgentSessionEvent );
		expect( update ).toMatchObject( {
			sessionUpdate: 'tool_call',
			toolCallId: 'call-1',
			kind: 'read',
			status: 'in_progress',
			locations: [ { path: '/Users/me/Studio/site/style.css' } ],
		} );
		expect( ( update as { title: string } ).title ).toContain( 'style.css' );
	} );

	it( 'falls back to the other kind for tools without a mapping', () => {
		const [ update ] = toSessionUpdates( {
			type: 'tool_execution_start',
			toolCallId: 'call-2',
			toolName: 'site_create',
			args: { name: 'Portfolio' },
		} as AgentSessionEvent );
		expect( update ).toMatchObject( { kind: 'other', title: 'Create site: Portfolio' } );
	} );

	it( 'closes a tool call with its text and image output', () => {
		expect(
			toSessionUpdates( {
				type: 'tool_execution_end',
				toolCallId: 'call-1',
				toolName: 'take_screenshot',
				isError: false,
				result: {
					content: [
						{ type: 'text', text: 'Captured.' },
						{ type: 'image', data: 'AAAA', mimeType: 'image/png' },
					],
				},
			} as AgentSessionEvent )
		).toEqual( [
			{
				sessionUpdate: 'tool_call_update',
				toolCallId: 'call-1',
				status: 'completed',
				content: [
					{ type: 'content', content: { type: 'text', text: 'Captured.' } },
					{ type: 'content', content: { type: 'image', data: 'AAAA', mimeType: 'image/png' } },
				],
			},
		] );
	} );

	it( 'marks a failed tool call as failed', () => {
		const [ update ] = toSessionUpdates( {
			type: 'tool_execution_end',
			toolCallId: 'call-3',
			toolName: 'Bash',
			isError: true,
			result: { content: [ { type: 'text', text: 'command not found' } ] },
		} as AgentSessionEvent );
		expect( update ).toMatchObject( { status: 'failed' } );
	} );
} );
