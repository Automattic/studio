import { ConnectError, type ConnectContext, type ProviderServices } from '@studio/providers';
import { describe, expect, it, vi } from 'vitest';
import { connectProvider } from '@studio/common/lib/ai-settings';
import { startProviderConnect } from '@studio/common/lib/provider-connect';

vi.mock( '@studio/common/lib/provider-config', () => ( {
	readSignInContext: async () => ( { hostId: 'host-1', remembered: { clientId: 'saved' } } ),
	writeProviderConfig: async () => undefined,
	readProviderConfig: async () => undefined,
	readAiFields: async () => ( {} ),
} ) );

// A provider whose site sends the browser straight back with `query`.
function providerRedirecting( query: string ) {
	const connect = vi.fn( async ( _method: string, input: Record< string, string > ) => input );
	const services = {
		id: 'openai',
		account: {
			start: async ( _method: string, { redirectUri, remembered }: ConnectContext ) => ( {
				url: `${ redirectUri }?${ query }`,
				handoff: { state: 'state-1', verifier: 'verifier-1', ...remembered },
			} ),
			connect,
		},
	} as unknown as ProviderServices;
	return { services, connect };
}

async function signIn( query: string, pasteUrl?: () => Promise< string > ) {
	const { services, connect } = providerRedirecting( query );
	const { url, handoff } = await startProviderConnect( services, 'chatgpt' );
	if ( ! pasteUrl ) {
		void fetch( url );
	}
	await connectProvider( services, 'chatgpt', handoff, { pasteUrl } );
	return connect.mock.calls[ 0 ][ 1 ];
}

describe( 'loopback sign-in', () => {
	it( 'listens on a free port, and hands the redirect to the provider with its handoff', async () => {
		const { services } = providerRedirecting( '' );
		const { url } = await startProviderConnect( services, 'chatgpt' );
		expect( url ).toMatch( /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback\?$/ );

		await expect( signIn( 'code=abc&state=state-1' ) ).resolves.toMatchObject( {
			clientId: 'saved',
			code: 'abc',
			state: 'state-1',
			verifier: 'verifier-1',
		} );
	} );

	it( 'refuses a redirect for another attempt', async () => {
		await expect( signIn( 'code=abc&state=other' ) ).rejects.toBeInstanceOf( ConnectError );
	} );

	it( 'takes the address the browser landed on, when pasted', async () => {
		await expect(
			signIn( '', async () => 'http://127.0.0.1:1/auth/callback?code=pasted&state=state-1' )
		).resolves.toMatchObject( { code: 'pasted', verifier: 'verifier-1' } );
	} );
} );
