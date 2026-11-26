import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConnectError, NotConnectedError, PROVIDER_IDS } from '@studio/providers';
import { getProviderServices } from '@studio/providers/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	connectProvider,
	disconnectProvider,
	readAiSettings,
	selectProviderModels,
	setAiProvider,
	setImageProvider,
} from '@studio/common/lib/ai-settings';
import { getConfigPath } from '@studio/common/lib/config/store';
import {
	forgetRejectedConfig,
	readFreshProviderConfig,
	readProviderConfig,
	readSignInContext,
} from '@studio/common/lib/provider-config';

const anthropic = getProviderServices( 'anthropic' );
const wpcom = getProviderServices( 'wpcom' );
const disconnected = { connected: false };
const allDisconnected = Object.fromEntries( PROVIDER_IDS.map( ( id ) => [ id, disconnected ] ) );

describe( 'ai settings', () => {
	let configDir: string;
	let previousDevConfigDir: string | undefined;

	const readProviders = () => JSON.parse( fs.readFileSync( getConfigPath(), 'utf8' ) ).providers;
	const writeProviders = ( providers: object ) =>
		fs.writeFileSync( getConfigPath(), JSON.stringify( { version: 1, providers } ) );
	const signedIn = {
		token: 'token',
		expiresAt: Date.now() + 3600_000,
		user: { id: 1, email: 'a@b.c', displayName: 'A' },
	};

	beforeEach( () => {
		configDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ai-settings-' ) );
		previousDevConfigDir = process.env.DEV_CONFIG_DIR;
		process.env.DEV_CONFIG_DIR = configDir;
		// Anthropic accepts keys unless a test says otherwise.
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: true, status: 200 } ) );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		if ( previousDevConfigDir === undefined ) {
			delete process.env.DEV_CONFIG_DIR;
		} else {
			process.env.DEV_CONFIG_DIR = previousDevConfigDir;
		}
		fs.rmSync( configDir, { recursive: true, force: true } );
	} );

	it( 'defaults to WordPress.com with nothing connected', async () => {
		await expect( readAiSettings() ).resolves.toEqual( {
			provider: 'wpcom',
			accounts: allDisconnected,
			imageProviders: [],
			imageProvider: null,
		} );
	} );

	it( 'stores an accepted key where every build reads it, and makes it the default without another', async () => {
		const settings = await connectProvider( anthropic, 'api-key', {
			apiKey: '  sk-ant-api03-testkey-abcd1234  ',
		} );

		expect( settings ).toEqual( {
			provider: 'anthropic',
			accounts: {
				...allDisconnected,
				anthropic: { connected: true, summary: 'sk-ant-api03-tes...1234', method: 'api-key' },
			},
			imageProviders: [],
			imageProvider: null,
		} );
		expect( readProviders() ).toMatchObject( {
			selected: 'anthropic-api-key',
			configs: { anthropic: { method: 'api-key', apiKey: 'sk-ant-api03-testkey-abcd1234' } },
		} );
	} );

	it( 'keeps a connected WordPress.com the default when another provider connects', async () => {
		writeProviders( { configs: { wpcom: signedIn } } );

		await expect(
			connectProvider( anthropic, 'api-key', { apiKey: 'sk-ant-api03-testkey-abcd1234' } )
		).resolves.toMatchObject( { provider: 'wpcom', accounts: { anthropic: { connected: true } } } );
		expect( readProviders().selected ).toBeUndefined();
	} );

	it( 'replaces an Anthropic API key with a subscription token, and back', async () => {
		writeProviders( {
			configs: { anthropic: { method: 'api-key', apiKey: 'sk-ant-api03-testkey-abcd1234' } },
		} );

		const settings = await connectProvider( anthropic, 'setup-token', {
			token: 'sk-ant-oat01-token-abcd1234',
		} );

		expect( settings.accounts.anthropic ).toMatchObject( {
			connected: true,
			method: 'setup-token',
		} );
		expect( readProviders().configs ).toEqual( {
			anthropic: { method: 'setup-token', token: 'sk-ant-oat01-token-abcd1234' },
		} );

		await connectProvider( anthropic, 'api-key', { apiKey: 'sk-ant-api03-testkey-abcd1234' } );

		await expect( readProviderConfig( 'anthropic' ) ).resolves.toEqual( {
			method: 'api-key',
			apiKey: 'sk-ant-api03-testkey-abcd1234',
		} );
	} );

	it( 'replaces a ChatGPT sign-in with an OpenAI API key', async () => {
		writeProviders( {
			configs: {
				openai: {
					method: 'chatgpt',
					clientId: 'oaiapp_1',
					accessToken: 'access',
					refreshToken: 'refresh',
					accessTokenExpiresAt: Date.now() + 3_600_000,
				},
			},
		} );

		const settings = await connectProvider( getProviderServices( 'openai' ), 'api-key', {
			apiKey: 'sk-proj-key',
		} );

		expect( settings.accounts.openai ).toMatchObject( { connected: true, method: 'api-key' } );
		expect( readProviders().configs.openai ).toEqual( {
			method: 'api-key',
			apiKey: 'sk-proj-key',
		} );
	} );

	it( 'does not store input the provider rejects', async () => {
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: false, status: 401 } ) );

		await expect(
			connectProvider( anthropic, 'api-key', { apiKey: 'sk-ant-api03-rejected' } )
		).rejects.toBeInstanceOf( ConnectError );
		expect( fs.existsSync( getConfigPath() ) ).toBe( false );
	} );

	it( 'selects only a connected provider, storing the id older builds read', async () => {
		await expect( setAiProvider( 'anthropic' ) ).rejects.toBeInstanceOf( ConnectError );

		await connectProvider( anthropic, 'api-key', { apiKey: 'sk-ant-api03-testkey-abcd1234' } );
		await expect( setAiProvider( 'anthropic' ) ).resolves.toMatchObject( {
			provider: 'anthropic',
		} );
		expect( readProviders().selected ).toBe( 'anthropic-api-key' );
	} );

	it( 'disconnects, falls back to WordPress.com, and keeps unrelated fields', async () => {
		fs.writeFileSync(
			getConfigPath(),
			JSON.stringify( {
				version: 1,
				providers: {
					selected: 'anthropic-api-key',
					configs: { anthropic: { method: 'api-key', apiKey: 'sk-ant-api03-testkey-abcd1234' } },
				},
				preferences: { locale: 'es' },
			} )
		);

		await expect( disconnectProvider( anthropic ) ).resolves.toEqual( {
			provider: 'wpcom',
			accounts: allDisconnected,
			imageProviders: [],
			imageProvider: null,
		} );
		const written = JSON.parse( fs.readFileSync( getConfigPath(), 'utf8' ) );
		expect( written ).toMatchObject( {
			providers: { selected: 'wpcom', configs: {} },
			preferences: { locale: 'es' },
		} );
	} );

	it( 'keeps the WordPress.com config in the Studio sign-in, and revokes it on disconnect', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue( {
				ok: true,
				json: async () => ( { ID: 7, email: 'me@example.com', display_name: 'Me' } ),
			} )
		);

		const settings = await connectProvider( wpcom, 'sign-in', {
			access_token: 'tok',
			expires_in: '3600',
		} );

		expect( settings.accounts.wpcom ).toEqual( {
			connected: true,
			method: 'sign-in',
			summary: 'me@example.com',
		} );
		expect( readProviders().configs.wpcom ).toEqual( {
			token: 'tok',
			expiresAt: expect.any( Number ),
			user: { id: 7, email: 'me@example.com', displayName: 'Me' },
		} );

		await disconnectProvider( wpcom );

		expect( fetch ).toHaveBeenLastCalledWith(
			'https://public-api.wordpress.com/wpcom/v2/studio-app/token',
			expect.objectContaining( { method: 'DELETE' } )
		);
		expect( readProviders().configs.wpcom ).toBeUndefined();
	} );

	it( 'disconnects a provider whose config expired or that the provider rejects', async () => {
		const rejected = () => Promise.reject( new NotConnectedError( 'Reconnect' ) );
		writeProviders( {
			configs: { spacefast: { apiKey: 'sfa_old', expiresAt: '2020-01-01T00:00:00Z' } },
		} );
		expect( ( await readAiSettings() ).accounts.spacefast.connected ).toBe( false );

		writeProviders( {
			configs: { wpcom: signedIn, spacefast: { apiKey: 'sfa_key', expiresAt: null } },
		} );
		await expect( forgetRejectedConfig( 'wpcom', rejected ) ).rejects.toThrow( 'Reconnect' );
		await expect( forgetRejectedConfig( 'spacefast', rejected ) ).rejects.toThrow( 'Reconnect' );
		expect( readProviders().configs ).toEqual( { wpcom: signedIn } );
	} );

	it( 'stores a renewed config, and forgets one the provider no longer accepts but its client', async () => {
		const stored = {
			method: 'chatgpt',
			accessToken: 'old',
			refreshToken: 'refresh',
			accessTokenExpiresAt: 0,
			clientId: 'oaiapp_1',
		} as const;
		writeProviders( { configs: { openai: stored } } );
		const refresh = vi.fn().mockResolvedValueOnce( { ...stored, accessToken: 'new' } );
		const services = getProviderServices( 'openai' );
		const openai = { ...services, account: { ...services.account!, refresh } };

		await expect( readFreshProviderConfig( openai ) ).resolves.toMatchObject( {
			accessToken: 'new',
		} );
		expect( readProviders().configs.openai.accessToken ).toBe( 'new' );

		refresh.mockRejectedValueOnce( new NotConnectedError( 'Sign in again' ) );
		await expect( readFreshProviderConfig( openai ) ).rejects.toThrow( 'Sign in again' );
		expect( readProviders().configs ).toEqual( {} );
		const context = await readSignInContext( 'openai' );
		expect( context.remembered ).toEqual( { clientId: 'oaiapp_1' } );
		expect( ( await readSignInContext( 'openai' ) ).hostId ).toBe( context.hostId );
	} );

	it( 'offers the models picked from a provider’s catalog', async () => {
		const openrouter = getProviderServices( 'openrouter' );
		const model = {
			id: 'openrouter/acme/model' as const,
			label: 'Acme: Model',
			supportsImages: false,
		};
		await expect( selectProviderModels( openrouter, [ model ] ) ).rejects.toBeInstanceOf(
			ConnectError
		);

		writeProviders( { configs: { openrouter: { method: 'api-key', apiKey: 'sk-or-v1' } } } );
		const settings = await selectProviderModels( openrouter, [ model ] );

		expect( settings.accounts.openrouter ).toMatchObject( {
			connected: true,
			models: [ { id: 'openrouter/acme/model', label: 'Acme: Model' } ],
		} );
	} );

	it( 'treats an unknown stored provider as the default', async () => {
		writeProviders( { selected: 'claude-code' } );

		await expect( readAiSettings() ).resolves.toMatchObject( { provider: 'wpcom' } );
	} );

	it( 'picks only a provider that generates images, and falls back to automatic without it', async () => {
		const chatgpt = {
			method: 'chatgpt',
			clientId: 'oaiapp_1',
			accessToken: 'access',
			refreshToken: 'refresh',
			accessTokenExpiresAt: 0,
		};
		writeProviders( {
			configs: { gemini: { method: 'api-key', apiKey: 'gemini-key' }, openai: chatgpt },
		} );
		await expect( setImageProvider( 'openai' ) ).rejects.toBeInstanceOf( ConnectError );

		await expect( setImageProvider( 'gemini' ) ).resolves.toMatchObject( {
			imageProviders: [ 'gemini' ],
			imageProvider: 'gemini',
		} );
		expect( readProviders().selectedImage ).toBe( 'gemini' );

		writeProviders( { selectedImage: 'gemini', configs: { openai: chatgpt } } );
		await expect( readAiSettings() ).resolves.toMatchObject( {
			imageProviders: [],
			imageProvider: null,
		} );

		await setImageProvider( null );
		expect( readProviders().selectedImage ).toBeUndefined();
	} );
} );
