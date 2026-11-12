import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvalidCredentialError } from '../../errors';
import { connectAnthropic, validateAnthropicApiKey } from '../account';

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

describe( 'connectAnthropic', () => {
	afterEach( () => vi.unstubAllGlobals() );

	it( 'stores a trimmed key Anthropic accepts or cannot check, and refuses one it rejects', async () => {
		vi.stubGlobal( 'fetch', vi.fn().mockRejectedValue( new Error( 'offline' ) ) );
		await expect( connectAnthropic( { apiKey: '  sk-ant-key  ' } ) ).resolves.toEqual( {
			method: 'api-key',
			apiKey: 'sk-ant-key',
		} );

		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: false, status: 401 } ) );
		await expect( connectAnthropic( { apiKey: 'sk-ant-bad' } ) ).rejects.toBeInstanceOf(
			InvalidCredentialError
		);
		await expect( connectAnthropic( { apiKey: '   ' } ) ).rejects.toThrow( 'API key is required' );
	} );
} );
