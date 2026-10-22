import { describe, expect, it } from 'vitest';
import { streamingReplyReducer } from './streaming-reply';

describe( 'streamingReplyReducer', () => {
	it( 'starts empty and applies batched deltas', () => {
		const started = streamingReplyReducer( null, {
			type: 'stream_started',
			entryId: 'entry-1',
			timestamp: 't0',
		} );
		const next = streamingReplyReducer( started, {
			type: 'stream_deltas',
			entryId: 'ignored',
			timestamp: 't1',
			deltas: [
				{ type: 'text_delta', contentIndex: 0, delta: 'Hi ' },
				{ type: 'text_delta', contentIndex: 0, delta: 'there' },
				{ type: 'toolcall_start', contentIndex: 1, id: 'call-1', name: 'Edit' },
			],
		} );
		expect( next ).toEqual( {
			entryId: 'entry-1',
			timestamp: 't0',
			message: {
				content: [
					{ type: 'text', text: 'Hi there' },
					{ type: 'toolCall', id: 'call-1', name: 'Edit', argumentsJson: '' },
				],
			},
		} );
	} );

	it( 'starts a reply from deltas alone, and only when they add something', () => {
		expect(
			streamingReplyReducer( null, {
				type: 'stream_deltas',
				entryId: 'entry-2',
				timestamp: 't',
				deltas: [ { type: 'text_end', contentIndex: 0 } ],
			} )
		).toBeNull();
		expect(
			streamingReplyReducer( null, {
				type: 'stream_deltas',
				entryId: 'entry-2',
				timestamp: 't',
				deltas: [ { type: 'text_delta', contentIndex: 0, delta: 'x' } ],
			} )
		).toMatchObject( {
			entryId: 'entry-2',
			message: { content: [ { type: 'text', text: 'x' } ] },
		} );
	} );

	it( 'ends the reply', () => {
		const state = streamingReplyReducer( null, {
			type: 'stream_started',
			entryId: 'entry-1',
			timestamp: 't0',
		} );
		expect( streamingReplyReducer( state, { type: 'stream_ended' } ) ).toBeNull();
	} );
} );
