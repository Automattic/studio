import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInWithChatGpt } from '@studio/agent/node/chatgpt-auth';
import {
	FileCredentialStore,
	getOrCreateDeviceId,
	hasChatGptCredential,
} from '@studio/agent/node/credential-store';
import {
	disconnectChatGpt,
	readAiSettings,
	setAiProvider,
} from '@studio/agent/node/settings-store';

const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';

// Plays the browser: follows the sign-in page's redirect back to the loopback
// callback, as OpenAI does once the user approves.
function returnFromBrowser( authorizeUrl: string, params: Record< string, string > ) {
	const { searchParams } = new URL( authorizeUrl );
	const callback = new URL( searchParams.get( 'redirect_uri' )! );
	callback.search = new URLSearchParams( {
		state: searchParams.get( 'state' )!,
		...params,
	} ).toString();
	http.get( callback, ( response ) => response.resume() );
}

const approve = ( url: string ) =>
	returnFromBrowser( url, { code: 'authorization-code', client_id: 'issued-client-id' } );

describe( 'Sign in with ChatGPT', () => {
	let configDir: string;
	let previousDevConfigDir: string | undefined;

	beforeEach( () => {
		configDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-chatgpt-auth-' ) );
		previousDevConfigDir = process.env.DEV_CONFIG_DIR;
		process.env.DEV_CONFIG_DIR = configDir;
		vi.spyOn( globalThis, 'fetch' ).mockImplementation( async ( input ) => {
			if ( String( input ) !== TOKEN_URL ) {
				throw new Error( `Unexpected request to ${ String( input ) }` );
			}
			return new Response(
				JSON.stringify( {
					access_token: 'chatgpt-access-token',
					refresh_token: 'chatgpt-refresh-token',
					id_token: 'header.payload.signature',
					expires_in: 3600,
					scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
				} )
			);
		} );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		if ( previousDevConfigDir === undefined ) {
			delete process.env.DEV_CONFIG_DIR;
		} else {
			process.env.DEV_CONFIG_DIR = previousDevConfigDir;
		}
		fs.rmSync( configDir, { recursive: true, force: true } );
	} );

	it( 'saves the account once the browser returns to the loopback callback', async () => {
		let authorizeUrl = '';
		await signInWithChatGpt( {
			openUrl: ( url ) => {
				authorizeUrl = url;
				approve( url );
			},
		} );

		const params = new URL( authorizeUrl ).searchParams;
		expect( params.get( 'client_id' ) ).toBe( 'dynamic_agent_client' );
		expect( params.get( 'agent_name_hint' ) ).toBe( 'WordPress Studio' );
		expect( params.get( 'ext_agent_host_id' ) ).toBe( `urn:uuid:${ await getOrCreateDeviceId() }` );
		await expect( new FileCredentialStore().read( 'openai' ) ).resolves.toMatchObject( {
			type: 'oauth',
			access: 'chatgpt-access-token',
			refresh: 'chatgpt-refresh-token',
			clientId: 'issued-client-id',
		} );
		await expect( readAiSettings() ).resolves.toMatchObject( { hasChatGptAccount: true } );
	} );

	it( 'saves nothing when the user declines in the browser', async () => {
		await expect(
			signInWithChatGpt( {
				openUrl: ( url ) => returnFromBrowser( url, { error: 'access_denied' } ),
			} )
		).rejects.toThrow( /access_denied/ );

		await expect( hasChatGptCredential() ).resolves.toBe( false );
	} );

	it( 'reports a cancelled sign-in', async () => {
		const controller = new AbortController();

		await expect(
			signInWithChatGpt( { openUrl: () => controller.abort(), signal: controller.signal } )
		).rejects.toThrow( 'ChatGPT sign-in was cancelled.' );
	} );

	it( 'refuses ChatGPT as the provider before signing in', async () => {
		await expect( setAiProvider( 'chatgpt' ) ).rejects.toThrow( 'Sign in with ChatGPT first.' );
	} );

	it( 'signs out and moves new chats back to WordPress.com', async () => {
		await signInWithChatGpt( { openUrl: approve } );
		await setAiProvider( 'chatgpt' );

		const settings = await disconnectChatGpt();

		expect( settings ).toMatchObject( { provider: 'wpcom', hasChatGptAccount: false } );
		await expect( hasChatGptCredential() ).resolves.toBe( false );
	} );
} );
