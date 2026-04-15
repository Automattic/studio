import { describe, expect, it, vi } from 'vitest';
import { JsonAdapter } from 'cli/ai/output-adapter';

describe( 'JsonAdapter subagent max-turns detection', () => {
	it( 'sets subagentMaxTurns when a Task tool_result contains the marker', () => {
		const adapter = new JsonAdapter();
		vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );

		adapter.handleMessage( {
			type: 'user',
			parent_tool_use_id: 'task-1',
			tool_use_result: {
				content: [
					{ type: 'text', text: 'Updated product 21.' },
					{
						type: 'text',
						text: 'Claude Code returned an error result: Reached maximum number of turns (50)',
					},
				],
			},
			message: { content: [] },
		} as never );

		expect( adapter.subagentMaxTurns ).toEqual( { lastProgress: 'Updated product 21.' } );
	} );

	it( 'resets subagentMaxTurns at the start of a new turn', () => {
		const adapter = new JsonAdapter();
		vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );
		adapter.subagentMaxTurns = { lastProgress: 'stale' };

		adapter.beginAgentTurn();

		expect( adapter.subagentMaxTurns ).toBeNull();
	} );

	it( 'emits maxTurnsScope on turn.completed when provided', () => {
		const adapter = new JsonAdapter();
		const written: string[] = [];
		vi.spyOn( process.stdout, 'write' ).mockImplementation( ( chunk ) => {
			written.push( String( chunk ) );
			return true;
		} );

		adapter.emitTurnCompleted( 'success', { numTurns: 12 }, 'subagent' );

		const event = JSON.parse( written[ 0 ] );
		expect( event.type ).toBe( 'turn.completed' );
		expect( event.status ).toBe( 'success' );
		expect( event.maxTurnsScope ).toBe( 'subagent' );
	} );
} );
