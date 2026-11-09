import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FileCredentialStore, getOrCreateDeviceId } from '../credential-store';
import { createChatGptProvider, signInWithChatGpt } from '../providers/chatgpt';
import { disconnectAiProvider, readAiSettings, setAiProvider } from '../settings-store';

let configDir: string;
beforeEach( () => {
	configDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-chatgpt-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
	vi.stubEnv( 'OPENAI_API_KEY', 'must-not-use-this-api-key' );
} );
afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	fs.rmSync( configDir, { recursive: true, force: true } );
} );

it( 'saves a browser-approved account without exposing tokens in settings, then disconnects it', async () => {
	vi.spyOn( globalThis, 'fetch' ).mockImplementation( async ( input ) => {
		if ( String( input ) !== 'https://auth.openai.com/api/accounts/oauth/token' ) {
			throw new Error( `Unexpected request: ${ String( input ) }` );
		}
		return new Response(
			JSON.stringify( {
				access_token: 'chatgpt-secret-access',
				refresh_token: 'chatgpt-secret-refresh',
				id_token: 'header.payload.signature',
				expires_in: 3600,
				scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
			} )
		);
	} );
	const store = new FileCredentialStore();
	await signInWithChatGpt( {
		credentials: store,
		deviceId: await getOrCreateDeviceId(),
		openUrl: ( url ) => {
			const authorize = new URL( url );
			const callback = new URL( authorize.searchParams.get( 'redirect_uri' )! );
			callback.search = new URLSearchParams( {
				state: authorize.searchParams.get( 'state' )!,
				code: 'approved-code',
				client_id: 'issued-client-id',
			} ).toString();
			http.get( callback, ( response ) => response.resume() );
		},
	} );
	await expect( store.read( 'openai' ) ).resolves.toMatchObject( {
		type: 'oauth',
		access: 'chatgpt-secret-access',
	} );
	const settings = await setAiProvider( 'chatgpt' );
	expect( settings.connections.chatgpt ).toEqual( { connected: true, apiKeyPreview: null } );
	expect( JSON.stringify( settings ) ).not.toContain( 'chatgpt-secret' );
	if ( process.platform !== 'win32' ) {
		expect( fs.statSync( path.join( configDir, 'ai-credentials.json' ) ).mode & 0o777 ).toBe( 0o600 );
	}
	const provider = createChatGptProvider( store );
	const runtime = await provider.createRuntime();
	expect( ( await disconnectAiProvider( 'chatgpt' ) ).provider ).toBe( 'wpcom' );
	await expect( store.read( 'openai' ) ).resolves.toBeUndefined();
	await expect( runtime.getAuth( provider.buildModel( 'gpt-6.1-terra' ) ) ).rejects.toThrow();
} );

it( 'does not use an API key when the selected subscription is disconnected', async () => {
	const provider = createChatGptProvider( new FileCredentialStore() );
	await expect( provider.createRuntime() ).rejects.toThrow( 'Sign in with ChatGPT first.' );
	await expect( setAiProvider( 'chatgpt' ) ).rejects.toThrow( 'Connect this provider first.' );
	expect( ( await readAiSettings() ).connections.chatgpt.connected ).toBe( false );
} );

it( 'cancels login when the browser cannot open without saving credentials', async () => {
	const credentials = new FileCredentialStore();
	await expect(
		signInWithChatGpt( {
			credentials,
			deviceId: await getOrCreateDeviceId(),
			openUrl: () => {
				throw new Error( 'Browser unavailable' );
			},
		} )
	).rejects.toThrow();
	await expect( credentials.read( 'openai' ) ).resolves.toBeUndefined();
} );

it( 'serializes credential refreshes without dropping other provider credentials', async () => {
	const store = new FileCredentialStore();
	await store.modify( 'openai', async () => ( {
		type: 'oauth',
		access: 'access',
		refresh: 'refresh',
		expires: 0,
	} ) );
	await store.modify( 'other', async () => ( { type: 'api_key', key: 'other-secret' } ) );
	const bump = () => store.modify( 'openai', async ( current ) => {
		if ( current?.type !== 'oauth' ) throw new Error( 'Missing credential' );
		return { ...current, expires: current.expires + 1 };
	} );
	await Promise.all( [ bump(), bump(), bump() ] );
	await expect( store.read( 'openai' ) ).resolves.toMatchObject( { expires: 3 } );
	await store.delete( 'openai' );
	await expect( store.read( 'other' ) ).resolves.toEqual( { type: 'api_key', key: 'other-secret' } );
} );
