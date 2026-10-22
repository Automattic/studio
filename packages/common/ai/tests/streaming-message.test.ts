import { describe, expect, it } from 'vitest';
import {
	applyAssistantMessageDelta,
	getStreamingToolCallStatus,
	parsePartialJson,
	type StreamingAssistantMessage,
} from '../streaming-message';
import type { AssistantMessageDelta } from '../json-events';

function applyAll( deltas: AssistantMessageDelta[] ): StreamingAssistantMessage {
	return deltas.reduce( applyAssistantMessageDelta, { content: [] } );
}

describe( 'applyAssistantMessageDelta', () => {
	it( 'grows text and tool-call blocks at their content index', () => {
		const message = applyAll( [
			{ type: 'text_start', contentIndex: 0 },
			{ type: 'text_delta', contentIndex: 0, delta: 'Hel' },
			{ type: 'text_delta', contentIndex: 0, delta: 'lo' },
			{ type: 'toolcall_start', contentIndex: 1, id: 'call-1', name: 'Write' },
			{ type: 'toolcall_delta', contentIndex: 1, delta: '{"path":' },
			{ type: 'toolcall_delta', contentIndex: 1, delta: '"a.css"' },
		] );
		expect( message.content ).toEqual( [
			{ type: 'text', text: 'Hello' },
			{ type: 'toolCall', id: 'call-1', name: 'Write', argumentsJson: '{"path":"a.css"' },
		] );
	} );

	it( 'starts from the first delta it sees when joined midway', () => {
		const message = applyAll( [
			{ type: 'toolcall_delta', contentIndex: 1, delta: '"content":"x' },
			{ type: 'text_delta', contentIndex: 2, delta: 'tail' },
		] );
		expect( message.content[ 0 ] ).toBeUndefined();
		expect( message.content[ 1 ] ).toBeUndefined();
		expect( message.content[ 2 ] ).toEqual( { type: 'text', text: 'tail' } );
	} );

	it( 'returns the same object for deltas that change nothing', () => {
		const message: StreamingAssistantMessage = { content: [ { type: 'text', text: 'a' } ] };
		expect( applyAssistantMessageDelta( message, { type: 'text_start', contentIndex: 0 } ) ).toBe(
			message
		);
		expect( applyAssistantMessageDelta( message, { type: 'text_end', contentIndex: 0 } ) ).toBe(
			message
		);
	} );
} );

describe( 'parsePartialJson', () => {
	it( 'parses complete JSON', () => {
		expect( parsePartialJson( '{"a":1,"b":[true,null],"c":"x"}' ) ).toEqual( {
			value: { a: 1, b: [ true, null ], c: 'x' },
			openStringPath: null,
		} );
	} );

	it( 'keeps a cut-off string and reports where it is', () => {
		expect( parsePartialJson( '{"path":"a.css","content":"line 1\\nli' ) ).toEqual( {
			value: { path: 'a.css', content: 'line 1\nli' },
			openStringPath: [ 'content' ],
		} );
	} );

	it( 'drops values that cannot be known yet', () => {
		expect( parsePartialJson( '{"a":12' ).value ).toEqual( {} );
		expect( parsePartialJson( '{"a":tr' ).value ).toEqual( {} );
		expect( parsePartialJson( '{"a":"x","b' ).value ).toEqual( { a: 'x' } );
		expect( parsePartialJson( '{"a":"\\u00' ).value ).toEqual( { a: '' } );
		expect( parsePartialJson( '' ).value ).toBeUndefined();
	} );
} );

describe( 'getStreamingToolCallStatus', () => {
	it( 'names the file and counts the lines written so far', () => {
		expect(
			getStreamingToolCallStatus( {
				name: 'Write',
				argumentsJson: '{"path":"themes/demo/style.css","content":"a\\nb\\nc',
			} )
		).toEqual( {
			label: 'Writing style.css…',
			target: 'themes/demo/style.css',
			progress: '3 lines',
		} );
	} );

	it( 'does not name a file whose path is still arriving', () => {
		expect(
			getStreamingToolCallStatus( { name: 'Write', argumentsJson: '{"path":"themes/de' } )
		).toEqual( { label: 'Writing file…', target: undefined, progress: undefined } );
	} );

	it( 'counts the replacement lines of an edit', () => {
		expect(
			getStreamingToolCallStatus( {
				name: 'Edit',
				argumentsJson: '{"path":"a.php","edits":[{"oldText":"x","newText":"1\\n2"},{"newText":"3',
			} )
		).toMatchObject( { label: 'Editing a.php…', progress: '3 lines' } );
	} );

	it( 'shows only the tool name for other tools', () => {
		expect(
			getStreamingToolCallStatus( { name: 'wp_cli', argumentsJson: '{"command":"plugin ins' } )
		).toEqual( { label: 'Run WordPress command…' } );
	} );

	it( 'never shows a half-written shell command', () => {
		expect(
			getStreamingToolCallStatus( { name: 'Bash', argumentsJson: '{"command":"rm -rf tmp' } )
		).toEqual( { label: 'Running command…' } );
	} );
} );
