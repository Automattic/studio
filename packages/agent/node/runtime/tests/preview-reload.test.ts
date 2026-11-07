import { describe, expect, it } from 'vitest';
import { changesPreview } from '../preview-reload';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

function turnEnd( results: Array< { name: string; isError?: boolean } > ) {
	return {
		type: 'turn_end',
		message: { role: 'assistant', content: [] },
		toolResults: results.map( ( result, i ) => ( {
			role: 'toolResult',
			toolCallId: `t${ i }`,
			toolName: result.name,
			isError: result.isError ?? false,
			content: [],
		} ) ),
	} as unknown as AgentSessionEvent;
}

describe( 'changesPreview', () => {
	it.each( [
		{ result: { name: 'Write' }, reloads: true },
		{ result: { name: 'Bash' }, reloads: true },
		{ result: { name: 'Read' }, reloads: false },
		{ result: { name: 'Edit', isError: true }, reloads: false },
	] )( 'reloads after $result.name: $reloads', ( { result, reloads } ) => {
		expect( changesPreview( turnEnd( [ result ] ) ) ).toBe( reloads );
	} );
} );
