import { InvalidCredentialError, type Provider } from '@studio/providers';
import { describe, expect, it } from 'vitest';
import { signInThroughLoopback } from '@studio/common/lib/loopback-sign-in';

// A provider whose site redirects straight back with `query`.
const providerRedirecting = ( query: string ) =>
	( {
		descriptor: { id: 'openai' },
		startLoopbackConnect: async ( redirectUri: string ) => ( {
			url: `${ redirectUri }?${ query }`,
			state: 'state-1',
			verifier: 'verifier-1',
		} ),
	} ) as unknown as Provider< unknown >;
const browser = { openUrl: ( url: string ) => void fetch( url ) };

describe( 'signInThroughLoopback', () => {
	it( 'listens on a free port, and returns the redirect with the verifier and the address', async () => {
		const input = await signInThroughLoopback(
			providerRedirecting( 'code=abc&state=state-1' ),
			browser
		);

		expect( input ).toMatchObject( { code: 'abc', state: 'state-1', verifier: 'verifier-1' } );
		expect( input.redirectUri ).toMatch( /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/ );
	} );

	it( 'refuses a redirect for another attempt', async () => {
		await expect(
			signInThroughLoopback( providerRedirecting( 'code=abc&state=other' ), browser )
		).rejects.toBeInstanceOf( InvalidCredentialError );
	} );

	it( 'takes the address the browser landed on, when pasted', async () => {
		await expect(
			signInThroughLoopback( providerRedirecting( '' ), {
				pasteUrl: async () => 'http://127.0.0.1:1/auth/callback?code=pasted&state=state-1',
			} )
		).resolves.toMatchObject( { code: 'pasted', verifier: 'verifier-1' } );
	} );
} );
