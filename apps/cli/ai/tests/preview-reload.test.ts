import { describe, expect, it } from 'vitest';
import { changesPreview } from 'cli/ai/runtimes/pi/preview-reload';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

function turnEnd(
	calls: Array< { name: string; args?: Record< string, unknown >; isError?: boolean } >
): AgentSessionEvent {
	return {
		type: 'turn_end',
		message: {
			role: 'assistant',
			content: calls.map( ( call, index ) => ( {
				type: 'toolCall',
				id: `call-${ index }`,
				name: call.name,
				arguments: call.args ?? {},
			} ) ),
		},
		toolResults: calls.map( ( call, index ) => ( {
			role: 'toolResult',
			toolCallId: `call-${ index }`,
			toolName: call.name,
			content: [],
			isError: call.isError ?? false,
		} ) ),
	} as unknown as AgentSessionEvent;
}

describe( 'changesPreview', () => {
	it( 'reloads after a turn that wrote a file or changed the site', () => {
		expect( changesPreview( turnEnd( [ { name: 'Edit' } ] ) ) ).toBe( true );
		expect(
			changesPreview(
				turnEnd( [ { name: 'wp_cli', args: { command: 'option update blogname Bakery' } } ] )
			)
		).toBe( true );
		expect(
			changesPreview(
				turnEnd( [ { name: 'wpcom_request', args: { method: 'POST', path: '/pages/4' } } ] )
			)
		).toBe( true );
	} );

	it( 'does not reload after a turn that only read', () => {
		expect( changesPreview( turnEnd( [ { name: 'Read' } ] ) ) ).toBe( false );
		expect(
			changesPreview( turnEnd( [ { name: 'wp_cli', args: { command: 'post list' } } ] ) )
		).toBe( false );
		expect(
			changesPreview(
				turnEnd( [ { name: 'wpcom_request', args: { method: 'GET', path: '/posts' } } ] )
			)
		).toBe( false );
	} );

	it( 'does not reload after a failed change', () => {
		expect( changesPreview( turnEnd( [ { name: 'Write', isError: true } ] ) ) ).toBe( false );
	} );

	it( 'reloads once per turn, at its end', () => {
		const end = turnEnd( [ { name: 'Write' }, { name: 'Edit' } ] );
		expect( changesPreview( end ) ).toBe( true );
		expect( changesPreview( { ...end, type: 'tool_execution_end' } as AgentSessionEvent ) ).toBe(
			false
		);
	} );
} );
