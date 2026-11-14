import { generateSummary } from '@earendil-works/pi-coding-agent';
import { expect, it, vi } from 'vitest';
import { createCompactor } from '@studio/agent/browser/compaction';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { Api, Message, Model, TranscriptContext } from '@earendil-works/pi-ai';

const model = { contextWindow: 50_000, reasoning: false } as Model< Api >;

// A stream that records each request and answers with `summary`.
function recordingStream( requests: TranscriptContext[] ): StreamFn {
	return async ( _model, context ) => {
		requests.push( context );
		return {
			result: async () => ( {
				role: 'assistant',
				content: [ { type: 'text', text: 'summary' } ],
				stopReason: 'stop',
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
			} ),
		} as never;
	};
}

it( 'summarizes the start of a long run with the request pi’s compaction sends', async () => {
	const messages: Message[] = [ 'first', 'second', 'third' ].map( ( name ) => ( {
		role: 'user',
		content: `${ name } ${ 'x'.repeat( 100_000 ) }`,
		timestamp: 0,
	} ) );
	const ours: TranscriptContext[] = [];
	const record = vi.fn();

	const view = await createCompactor( model, recordingStream( ours ), record ).transform(
		messages
	);

	expect( view ).toHaveLength( 2 );
	expect( view[ 1 ] ).toBe( messages[ 2 ] );
	expect( record ).toHaveBeenCalledWith( expect.objectContaining( { summary: 'summary' } ), 1 );
	const pi: TranscriptContext[] = [];
	await generateSummary(
		messages.slice( 0, 2 ),
		model,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		recordingStream( pi )
	);
	const withoutTimestamps = ( context: TranscriptContext ) =>
		context.messages.map( ( { timestamp, ...message } ) => message );
	expect( withoutTimestamps( ours[ 0 ] ) ).toEqual( withoutTimestamps( pi[ 0 ] ) );
} );
