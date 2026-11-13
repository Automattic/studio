import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConnectError, NotConnectedError } from '@studio/providers';
import { getProviderServices } from '@studio/providers/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	connectProvider,
	disconnectProvider,
	readAiSettings,
	setAiProvider,
} from '@studio/common/lib/ai-settings';
import {
	forgetRejectedConfig,
	readFreshProviderConfig,
	readProviderConfig,
	readSignInContext,
} from '@studio/common/lib/provider-config';

const anthropic = getProviderServices( 'anthropic' );
const wpcom = getProviderServices( 'wpcom' );
const disconnected = { connected: false };

describe( 'ai settings', () => {
	let configDir: string;
	let previousDevConfigDir: string | undefined;

	const sharedConfigPath = () => path.join( configDir, 'shared.json' );
	const cliConfigPath = () => path.join( configDir, 'cli.json' );
	const readShared = () => JSON.parse( fs.readFileSync( sharedConfigPath(), 'utf8' ) );
	const writeShared = ( config: object ) =>
		fs.writeFileSync( sharedConfigPath(), JSON.stringify( { version: 1, ...config } ) );

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
			accounts: {
				wpcom: disconnected,
				anthropic: disconnected,
				openai: disconnected,
				gemini: disconnected,
				xai: disconnected,
				spacefast: disconnected,
			},
		} );
	} );

	it( 'stores an accepted key where every build reads it, and makes it the default without another', async () => {
		const settings = await connectProvider( anthropic, 'api-key', {
			apiKey: '  sk-ant-api03-testkey-abcd1234  ',
		} );

		expect( settings ).toEqual( {
			provider: 'anthropic',
			accounts: {
				wpcom: disconnected,
				anthropic: { connected: true, summary: 'sk-ant-api03-tes...1234', method: 'api-key' },
				openai: disconnected,
				gemini: disconnected,
				xai: disconnected,
				spacefast: disconnected,
			},
		} );
		expect( readShared().anthropicApiKey ).toBe( 'sk-ant-api03-testkey-abcd1234' );
		expect( fs.existsSync( cliConfigPath() ) ).toBe( false );
	} );

	it( 'keeps a connected WordPress.com the default when another provider connects', async () => {
		writeShared( {
			authToken: {
				accessToken: 'token',
				expirationTime: Date.now() + 3600_000,
				expiresIn: 3600,
				id: 1,
				email: 'a@b.c',
				displayName: 'A',
			},
		} );

		await expect(
			connectProvider( anthropic, 'api-key', { apiKey: 'sk-ant-api03-testkey-abcd1234' } )
		).resolves.toMatchObject( { provider: 'wpcom', accounts: { anthropic: { connected: true } } } );
		expect( readShared().aiProvider ).toBeUndefined();
	} );

	it( 'keeps a subscription token in its own section, and clears the other method on write', async () => {
		writeShared( { anthropicApiKey: 'sk-ant-api03-testkey-abcd1234' } );

		const settings = await connectProvider( anthropic, 'setup-token', {
			token: 'sk-ant-oat01-token-abcd1234',
		} );

		expect( settings.accounts.anthropic ).toMatchObject( {
			connected: true,
			method: 'setup-token',
		} );
		expect( readShared() ).toMatchObject( {
			providerConfigs: {
				anthropic: { method: 'setup-token', token: 'sk-ant-oat01-token-abcd1234' },
			},
		} );
		expect( readShared().anthropicApiKey ).toBeUndefined();

		await connectProvider( anthropic, 'api-key', { apiKey: 'sk-ant-api03-testkey-abcd1234' } );

		expect( readShared().providerConfigs ).toBeUndefined();
		await expect( readProviderConfig( 'anthropic' ) ).resolves.toEqual( {
			method: 'api-key',
			apiKey: 'sk-ant-api03-testkey-abcd1234',
		} );
	} );

	it( 'replaces a ChatGPT sign-in with an OpenAI API key', async () => {
		writeShared( {
			providerConfigs: {
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
		expect( readShared().providerConfigs.openai ).toEqual( {
			method: 'api-key',
			apiKey: 'sk-proj-key',
		} );
	} );

	it( 'does not store input the provider rejects', async () => {
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: false, status: 401 } ) );

		await expect(
			connectProvider( anthropic, 'api-key', { apiKey: 'sk-ant-api03-rejected' } )
		).rejects.toBeInstanceOf( ConnectError );
		expect( fs.existsSync( sharedConfigPath() ) ).toBe( false );
	} );

	it( 'reads legacy values from cli.json and migrates them on write', async () => {
		fs.writeFileSync(
			cliConfigPath(),
			JSON.stringify( {
				version: 1,
				aiProvider: 'anthropic-api-key',
				anthropicApiKey: 'sk-ant-api03-legacykey-9999',
			} )
		);

		await expect( readAiSettings() ).resolves.toMatchObject( {
			provider: 'anthropic',
			accounts: { anthropic: { connected: true } },
		} );

		await setAiProvider( 'anthropic' );

		expect( readShared() ).toMatchObject( {
			aiProvider: 'anthropic-api-key',
			anthropicApiKey: 'sk-ant-api03-legacykey-9999',
		} );
	} );

	it( 'selects only a connected provider, storing the id older builds read', async () => {
		await expect( setAiProvider( 'anthropic' ) ).rejects.toBeInstanceOf( ConnectError );

		await connectProvider( anthropic, 'api-key', { apiKey: 'sk-ant-api03-testkey-abcd1234' } );
		await expect( setAiProvider( 'anthropic' ) ).resolves.toMatchObject( {
			provider: 'anthropic',
		} );
		expect( readShared().aiProvider ).toBe( 'anthropic-api-key' );
	} );

	it( 'disconnects, falls back to WordPress.com, and keeps unrelated fields', async () => {
		writeShared( {
			anthropicApiKey: 'sk-ant-api03-testkey-abcd1234',
			aiProvider: 'anthropic-api-key',
			locale: 'es',
		} );

		await expect( disconnectProvider( anthropic ) ).resolves.toEqual( {
			provider: 'wpcom',
			accounts: {
				wpcom: disconnected,
				anthropic: disconnected,
				openai: disconnected,
				gemini: disconnected,
				xai: disconnected,
				spacefast: disconnected,
			},
		} );
		const written = readShared();
		expect( written.anthropicApiKey ).toBeUndefined();
		expect( written ).toMatchObject( { aiProvider: 'wpcom', locale: 'es' } );
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
		expect( readShared().authToken ).toMatchObject( {
			accessToken: 'tok',
			expiresIn: 3600,
			id: 7,
			email: 'me@example.com',
			displayName: 'Me',
		} );
		await expect( readProviderConfig( 'wpcom' ) ).resolves.toMatchObject( {
			token: 'tok',
			user: { id: 7 },
		} );

		await disconnectProvider( wpcom );

		expect( fetch ).toHaveBeenLastCalledWith(
			'https://public-api.wordpress.com/wpcom/v2/studio-app/token',
			expect.objectContaining( { method: 'DELETE' } )
		);
		expect( readShared().authToken ).toBeUndefined();
	} );

	it( 'disconnects a provider whose config expired or that the provider rejects', async () => {
		const rejected = () => Promise.reject( new NotConnectedError( 'Reconnect' ) );
		writeShared( {
			providerConfigs: { spacefast: { apiKey: 'sfa_old', expiresAt: '2020-01-01T00:00:00Z' } },
		} );
		expect( ( await readAiSettings() ).accounts.spacefast.connected ).toBe( false );

		writeShared( {
			authToken: {
				accessToken: 'token',
				expirationTime: Date.now() + 3600_000,
				expiresIn: 3600,
				id: 1,
				email: 'a@b.c',
				displayName: 'A',
			},
			providerConfigs: { spacefast: { apiKey: 'sfa_key', expiresAt: null } },
		} );
		await expect( forgetRejectedConfig( 'wpcom', rejected ) ).rejects.toThrow( 'Reconnect' );
		await expect( forgetRejectedConfig( 'spacefast', rejected ) ).rejects.toThrow( 'Reconnect' );
		expect( readShared().providerConfigs ).toBeUndefined();
		expect( readShared().authToken ).toMatchObject( { accessToken: 'token' } );
	} );

	it( 'stores a renewed config, and forgets one the provider no longer accepts but its client', async () => {
		const stored = {
			method: 'chatgpt',
			accessToken: 'old',
			refreshToken: 'refresh',
			accessTokenExpiresAt: 0,
			clientId: 'oaiapp_1',
		} as const;
		writeShared( { providerConfigs: { openai: stored } } );
		const refresh = vi.fn().mockResolvedValueOnce( { ...stored, accessToken: 'new' } );
		const services = getProviderServices( 'openai' );
		const openai = { ...services, account: { ...services.account, refresh } };

		await expect( readFreshProviderConfig( openai ) ).resolves.toMatchObject( {
			accessToken: 'new',
		} );
		expect( readShared().providerConfigs.openai.accessToken ).toBe( 'new' );

		refresh.mockRejectedValueOnce( new NotConnectedError( 'Sign in again' ) );
		await expect( readFreshProviderConfig( openai ) ).rejects.toThrow( 'Sign in again' );
		expect( readShared().providerConfigs ).toBeUndefined();
		const context = await readSignInContext( 'openai' );
		expect( context.remembered ).toEqual( { clientId: 'oaiapp_1' } );
		expect( ( await readSignInContext( 'openai' ) ).hostId ).toBe( context.hostId );
	} );

	it( 'treats an unknown stored provider as the default', async () => {
		fs.writeFileSync(
			cliConfigPath(),
			JSON.stringify( { version: 1, aiProvider: 'claude-code' } )
		);

		await expect( readAiSettings() ).resolves.toMatchObject( { provider: 'wpcom' } );
	} );
} );
