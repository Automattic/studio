import { normalizeContext, type Api, type Model } from '@earendil-works/pi-ai';
import { expect, it, vi } from 'vitest';
import { createConnectionStream } from '../models';
import type { AiConnection } from '@studio/providers';

it( 'ends a turn on an API Studio doesn’t run with an error naming it, without a request', async () => {
	const model: Model< Api > = {
		id: 'sample-large',
		name: 'Sample Large',
		api: 'mistral-conversations',
		provider: 'sample',
		baseUrl: 'https://api.sample.test/v1',
		reasoning: false,
		input: [ 'text' ],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 8_000,
	};
	// A connection cast past the contract's types.
	const ai = { piProvider: 'sample', apiKey: 'key', model } as unknown as AiConnection;
	const request = vi.spyOn( globalThis, 'fetch' ).mockRejectedValue( new Error( 'offline' ) );
	try {
		const context = normalizeContext( {
			messages: [ { role: 'user', content: 'Hi', timestamp: 0 } ],
		} );
		const reply = await createConnectionStream( ai )( model, context, {
			apiKey: ai.apiKey,
		} ).result();

		expect( reply ).toMatchObject( {
			stopReason: 'error',
			errorMessage:
				'Studio doesn’t run the mistral-conversations API, which sample-large connects over.',
		} );
		expect( request ).not.toHaveBeenCalled();
	} finally {
		request.mockRestore();
	}
} );
