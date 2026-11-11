import { normalizeContext } from '@earendil-works/pi-ai';
import { getProvider } from '@studio/providers/services';
import { expect, it, vi } from 'vitest';
import { createStreamFn } from '../models';

it( 'streams a Gemini reply through the Google SDK using the connected key', async () => {
	const ai = await getProvider( 'gemini' ).ai!.connect(
		{ method: 'api-key', apiKey: 'test-key' },
		'gemini-4-carbon',
		{}
	);
	const chunk = {
		candidates: [ { content: { parts: [ { text: 'Hello' } ] }, finishReason: 'STOP' } ],
	};
	const request = vi.spyOn( globalThis, 'fetch' ).mockResolvedValue(
		new Response( `data: ${ JSON.stringify( chunk ) }\n\n`, {
			headers: { 'Content-Type': 'text/event-stream' },
		} )
	);
	try {
		const context = normalizeContext( {
			messages: [ { role: 'user', content: 'Hi', timestamp: 0 } ],
		} );
		const stream = await createStreamFn( ai )( ai.model, context );
		const reply = await stream.result();
		expect( reply.stopReason ).toBe( 'stop' );
		expect( reply.content ).toContainEqual( { type: 'text', text: 'Hello' } );
		const [ url, init ] = request.mock.calls[ 0 ];
		expect( String( url ) ).toContain( '/v1beta/models/gemini-4-carbon:streamGenerateContent' );
		expect( new Headers( init?.headers ).get( 'x-goog-api-key' ) ).toBe( 'test-key' );
	} finally {
		request.mockRestore();
	}
} );
