import { describe, expect, it } from 'vitest';
import { changesPreview } from '../preview-reload';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

function turnEnd( calls: Array< { name: string; args?: object; isError?: boolean } > ) {
	return {
		type: 'turn_end',
		message: {
			role: 'assistant',
			content: calls.map( ( call, i ) => ( {
				type: 'toolCall',
				id: `t${ i }`,
				name: call.name,
				arguments: call.args ?? {},
			} ) ),
		},
		toolResults: calls.map( ( call, i ) => ( {
			role: 'toolResult',
			toolCallId: `t${ i }`,
			toolName: call.name,
			isError: call.isError ?? false,
			content: [],
		} ) ),
	} as unknown as AgentSessionEvent;
}

describe( 'changesPreview', () => {
	it( 'reloads after a successful write or a changing WP-CLI command', () => {
		expect( changesPreview( turnEnd( [ { name: 'Write' } ] ) ) ).toBe( true );
		expect(
			changesPreview(
				turnEnd( [ { name: 'wp_cli', args: { command: 'option update blogname list' } } ] )
			)
		).toBe( true );
	} );

	it( 'skips reads, failures, and read-only WP-CLI commands', () => {
		expect( changesPreview( turnEnd( [ { name: 'Read' } ] ) ) ).toBe( false );
		expect( changesPreview( turnEnd( [ { name: 'Edit', isError: true } ] ) ) ).toBe( false );
		expect(
			changesPreview(
				turnEnd( [ { name: 'wp_cli', args: { command: 'post list --format=ids' } } ] )
			)
		).toBe( false );
	} );
} );
