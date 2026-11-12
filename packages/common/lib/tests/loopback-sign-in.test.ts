import http from 'http';
import { InvalidCredentialError, type Provider } from '@studio/providers';
import { afterEach, describe, expect, it } from 'vitest';
import { signInThroughLoopback } from '@studio/common/lib/loopback-sign-in';

const PORT = 41455;
const redirectUri = `http://localhost:${ PORT }/auth/callback`;
const provider = {
	descriptor: { id: 'openai' },
	startLoopbackConnect: async () => ( {
		url: 'https://example.com/authorize',
		redirectUri,
		state: 'state-1',
		verifier: 'verifier-1',
	} ),
} as unknown as Provider< unknown >;

// The browser coming back to Studio.
const redirectBrowser = ( query: string ) => () =>
	void fetch( `http://127.0.0.1:${ PORT }/auth/callback?${ query }` );

describe( 'signInThroughLoopback', () => {
	let blocker: http.Server | undefined;

	afterEach( () => {
		blocker?.close();
		blocker = undefined;
	} );

	it( 'opens the sign-in once listening, and returns the redirect with the verifier', async () => {
		await expect(
			signInThroughLoopback( provider, { openUrl: redirectBrowser( 'code=abc&state=state-1' ) } )
		).resolves.toEqual( { code: 'abc', state: 'state-1', verifier: 'verifier-1' } );
	} );

	it( 'refuses a redirect for another attempt, or a declined one', async () => {
		await expect(
			signInThroughLoopback( provider, { openUrl: redirectBrowser( 'code=abc&state=other' ) } )
		).rejects.toBeInstanceOf( InvalidCredentialError );
		await expect(
			signInThroughLoopback( provider, {
				openUrl: redirectBrowser( 'error=access_denied&state=state-1' ),
			} )
		).rejects.toMatchObject( { reason: 'denied' } );
	} );

	it( 'takes a pasted address when another app holds the port', async () => {
		blocker = http.createServer().listen( PORT, '127.0.0.1' );
		await new Promise( ( resolve ) => blocker!.once( 'listening', resolve ) );

		await expect( signInThroughLoopback( provider, {} ) ).rejects.toThrow( `port ${ PORT }` );
		await expect(
			signInThroughLoopback( provider, {
				pasteUrl: async () => `${ redirectUri }?code=pasted&state=state-1`,
			} )
		).resolves.toMatchObject( { code: 'pasted', verifier: 'verifier-1' } );
	} );

	it( 'cancels a sign-in still waiting when another starts', async () => {
		const first = signInThroughLoopback( provider, {} );
		const second = signInThroughLoopback( provider, {
			openUrl: redirectBrowser( 'code=abc&state=state-1' ),
		} );

		await expect( first ).rejects.toThrow( 'canceled' );
		await expect( second ).resolves.toMatchObject( { code: 'abc' } );
	} );
} );
