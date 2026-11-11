import { describe, expect, it } from 'vitest';
import {
	emptyClaudeTranscript,
	parseClaudeEvent,
	type ClaudeStreamEvent,
} from '../eval-harnesses/claude-code';

// Claude Code's newline-delimited stream (system init, assistant, tool response, result).
const recording = `
{"type":"system","subtype":"init","session_id":"session-123","tools":["Bash"],"model":"claude-sonnet-4-6"}
{"type":"assistant","session_id":"session-123","message":{"role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"I will check the active theme."},{"type":"tool_use","id":"toolu_01","name":"Bash","input":{"command":"studio site list"}}]}}
{"type":"user","session_id":"session-123","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01","content":[{"type":"text","text":"Example Site"}],"is_error":false}]}}
{"type":"assistant","session_id":"session-123","message":{"role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"The site is ready."}]}}
{"type":"result","subtype":"success","is_error":false,"session_id":"session-123","num_turns":2,"result":"The site is ready.","usage":{"input_tokens":42,"output_tokens":23,"cache_read_input_tokens":100,"cache_creation_input_tokens":15}}
`;

describe( 'Claude Code stream transcript', () => {
	it( 'captures text, tool outcomes, usage and a matching stop boundary', () => {
		const events = recording
			.trim()
			.split( '\n' )
			.map( ( line ) => JSON.parse( line ) as ClaudeStreamEvent );
		const transcript = events.reduce(
			( state, event, index ) =>
				parseClaudeEvent( state, event, index * 100, [
					{ tool: 'Bash', input: { command: '^studio site' } },
				] ),
			emptyClaudeTranscript()
		);
		expect( transcript.textSegments ).toEqual( [
			'I will check the active theme.',
			'The site is ready.',
		] );
		expect( transcript.toolCalls ).toEqual( [
			{ id: 'toolu_01', name: 'Bash', input: { command: 'studio site list' } },
		] );
		expect( transcript.toolResults ).toEqual( [
			{ toolUseId: 'toolu_01', toolName: 'Bash', isError: false, text: 'Example Site' },
		] );
		expect( transcript.usage ).toEqual( {
			input: 42,
			output: 23,
			cacheRead: 100,
			cacheWrite: 15,
			totalTokens: 180,
		} );
		expect( transcript.stoppedAt ).toEqual( { toolUseId: 'toolu_01', toolName: 'Bash', index: 0 } );
		expect( transcript.toolEvents[ 0 ] ).toMatchObject( {
			startedAtMs: 100,
			endedAtMs: 200,
			durationMs: 100,
			outputChars: 12,
		} );
		expect( transcript ).toMatchObject( { success: true, numTurns: 2, stopReason: 'success' } );
	} );
} );
