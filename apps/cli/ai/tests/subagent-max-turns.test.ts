import { describe, expect, it } from 'vitest';
import { detectSubagentMaxTurns, SUBAGENT_MAX_TURNS_MARKER } from 'cli/ai/subagent-max-turns';

describe( 'SUBAGENT_MAX_TURNS_MARKER', () => {
	it( 'pins the exact SDK error substring we key on', () => {
		// If this test fails after an SDK bump, inspect the new error string
		// and update the marker + any matching tests intentionally.
		expect( SUBAGENT_MAX_TURNS_MARKER ).toBe( 'Reached maximum number of turns' );
	} );
} );

describe( 'detectSubagentMaxTurns', () => {
	it( 'returns null when content does not contain the marker', () => {
		expect( detectSubagentMaxTurns( 'Site "aura" stopped.' ) ).toBeNull();
		expect( detectSubagentMaxTurns( '' ) ).toBeNull();
		expect( detectSubagentMaxTurns( null ) ).toBeNull();
		expect( detectSubagentMaxTurns( undefined ) ).toBeNull();
	} );

	it( 'detects the marker in a plain string', () => {
		const input = 'Claude Code returned an error result: Reached maximum number of turns (50)';
		expect( detectSubagentMaxTurns( input ) ).toEqual( { lastProgress: null } );
	} );

	it( 'detects the marker inside an array of content blocks', () => {
		const input = [
			{ type: 'text', text: 'Previous step: created product 21.' },
			{
				type: 'text',
				text: 'Claude Code returned an error result: Reached maximum number of turns (50)',
			},
		];
		expect( detectSubagentMaxTurns( input ) ).toEqual( {
			lastProgress: 'Previous step: created product 21.',
		} );
	} );

	it( 'truncates long progress to 200 characters', () => {
		const long = 'x'.repeat( 500 );
		const input = [
			{ type: 'text', text: long },
			{ type: 'text', text: 'Reached maximum number of turns (50)' },
		];
		const result = detectSubagentMaxTurns( input );
		expect( result?.lastProgress ).toHaveLength( 200 );
	} );

	it( 'ignores non-text blocks when extracting progress', () => {
		const input = [
			{ type: 'tool_use', name: 'Bash' },
			{ type: 'text', text: 'Created variation 3 of 5.' },
			{ type: 'text', text: 'Reached maximum number of turns (50)' },
		];
		expect( detectSubagentMaxTurns( input )?.lastProgress ).toBe( 'Created variation 3 of 5.' );
	} );
} );
