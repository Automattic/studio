import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectError, NotConnectedError } from '../../errors';
import { geminiAccount } from '../account';
import { geminiAi } from '../ai';
import { GEMINI_AI_MODELS } from '../descriptor';

afterEach( () => {
	vi.unstubAllGlobals();
} );

describe( 'gemini account', () => {
	const connect = ( response: Partial< Response > | Error ) => {
		const fetchMock =
			response instanceof Error
				? vi.fn().mockRejectedValue( response )
				: vi.fn().mockResolvedValue( response );
		vi.stubGlobal( 'fetch', fetchMock );
		return { fetchMock, result: geminiAccount.connect( 'api-key', { apiKey: ' AIza-test ' } ) };
	};

	it( 'checks the key with Google and stores it trimmed', async () => {
		const { fetchMock, result } = connect( { ok: true, status: 200 } );

		await expect( result ).resolves.toEqual( { method: 'api-key', apiKey: 'AIza-test' } );
		expect( fetchMock ).toHaveBeenCalledWith(
			expect.stringContaining( 'generativelanguage.googleapis.com' ),
			expect.objectContaining( { headers: { 'x-goog-api-key': 'AIza-test' } } )
		);
	} );

	it.each( [ 400, 403 ] )( 'refuses a key Google rejects (%d)', async ( status ) => {
		await expect( connect( { ok: false, status } ).result ).rejects.toBeInstanceOf( ConnectError );
	} );

	it( 'accepts a key it can’t check', async () => {
		await expect( connect( new Error( 'offline' ) ).result ).resolves.toMatchObject( {
			apiKey: 'AIza-test',
		} );
	} );
} );

describe( 'gemini ai', () => {
	it( 'asks to connect without a config', async () => {
		await expect( geminiAi.model( undefined, 'gemini-3.8-flash', {} ) ).rejects.toBeInstanceOf(
			NotConnectedError
		);
	} );

	it.each( GEMINI_AI_MODELS.map( ( model ) => model.id ) )(
		'serves %s from pi’s catalog over Google’s API',
		async ( id ) => {
			const { piProvider, apiKey, model } = await geminiAi.model(
				{ method: 'api-key', apiKey: 'AIza-test' },
				id,
				{}
			);

			expect( piProvider ).toBe( 'google' );
			expect( apiKey ).toBe( 'AIza-test' );
			expect( model ).toMatchObject( { id, api: 'google-generative-ai', maxTokens: 32_000 } );
		}
	);
} );
