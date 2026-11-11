import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateGeminiApiKey } from '../providers/gemini-key';

describe( 'validateGeminiApiKey', () => {
	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	function stubFetch( response: Partial< Response > | Error ) {
		const fetchMock =
			response instanceof Error
				? vi.fn().mockRejectedValue( response )
				: vi.fn().mockResolvedValue( response );
		vi.stubGlobal( 'fetch', fetchMock );
		return fetchMock;
	}

	it( 'reports a working key as valid and sends the Google API key header', async () => {
		const fetchMock = stubFetch( { ok: true, status: 200 } );

		await expect( validateGeminiApiKey( 'AIzaSyTestKey1234' ) ).resolves.toEqual( {
			status: 'valid',
		} );
		expect( fetchMock ).toHaveBeenCalledWith(
			'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
			expect.objectContaining( {
				headers: expect.objectContaining( { 'x-goog-api-key': 'AIzaSyTestKey1234' } ),
			} )
		);
	} );

	it.each( [ 400, 401, 403 ] )(
		'reports a rejected key response (%d) as invalid',
		async ( status ) => {
			stubFetch( { ok: false, status } );

			await expect( validateGeminiApiKey( 'AIzaSyBadKey' ) ).resolves.toMatchObject( {
				status: 'invalid',
			} );
		}
	);

	it.each( [ 429, 500 ] )(
		'reports a non-auth API failure (%d) as unverifiable, not invalid',
		async ( status ) => {
			stubFetch( { ok: false, status } );

			await expect( validateGeminiApiKey( 'AIzaSyTestKey1234' ) ).resolves.toMatchObject( {
				status: 'unverifiable',
			} );
		}
	);

	it( 'reports a network failure as unverifiable', async () => {
		stubFetch( new Error( 'network down' ) );

		await expect( validateGeminiApiKey( 'AIzaSyTestKey1234' ) ).resolves.toMatchObject( {
			status: 'unverifiable',
		} );
	} );
} );
