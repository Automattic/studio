import { normalizeContext } from '@earendil-works/pi-ai';
import { getProviderServices } from '@studio/providers/services';
import { expect, it, vi } from 'vitest';
import { createStreamFn } from '../models';

it( 'streams a Gemini reply through Google’s SDK with the connected key', async () => {
	const ai = await getProviderServices( 'gemini' ).ai!.model(
		{ method: 'api-key', apiKey: 'test-key' },
		'gemini-3.8-flash',
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
		const reply = await createStreamFn( ai )( ai.model, context ).result();
		expect( reply ).toMatchObject( { stopReason: 'stop' } );
		expect( reply.content ).toContainEqual( { type: 'text', text: 'Hello' } );
		const [ url, init ] = request.mock.calls[ 0 ];
		expect( String( url ) ).toContain( '/models/gemini-3.8-flash:streamGenerateContent' );
		expect( new Headers( init?.headers ).get( 'x-goog-api-key' ) ).toBe( 'test-key' );
	} finally {
		request.mockRestore();
	}
} );
