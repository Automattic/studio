import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateAnthropicApiKey } from '../anthropic-key';

describe( 'validateAnthropicApiKey', () => {
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

	it( 'reports a working key as valid and sends the Anthropic auth headers', async () => {
		const fetchMock = stubFetch( { ok: true, status: 200 } );

		await expect( validateAnthropicApiKey( 'sk-ant-test-1234' ) ).resolves.toEqual( {
			status: 'valid',
		} );
		expect( fetchMock ).toHaveBeenCalledWith(
			'https://api.anthropic.com/v1/models?limit=1',
			expect.objectContaining( {
				headers: expect.objectContaining( { 'x-api-key': 'sk-ant-test-1234' } ),
			} )
		);
	} );

	it.each( [ 401, 403 ] )(
		'reports an authentication failure (%d) as invalid',
		async ( status ) => {
			stubFetch( { ok: false, status } );

			await expect( validateAnthropicApiKey( 'sk-ant-bad' ) ).resolves.toMatchObject( {
				status: 'invalid',
			} );
		}
	);

	it.each( [ 429, 500 ] )(
		'reports a non-auth API failure (%d) as unverifiable, not invalid',
		async ( status ) => {
			stubFetch( { ok: false, status } );

			await expect( validateAnthropicApiKey( 'sk-ant-test-1234' ) ).resolves.toMatchObject( {
				status: 'unverifiable',
			} );
		}
	);

	it( 'reports a network failure as unverifiable', async () => {
		stubFetch( new Error( 'network down' ) );

		await expect( validateAnthropicApiKey( 'sk-ant-test-1234' ) ).resolves.toMatchObject( {
			status: 'unverifiable',
		} );
	} );
} );
