import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	InvalidAiProviderCredentialsError,
	readAiSettings,
	saveAiProviderApiKey,
	setAiProvider,
} from '@studio/agent/node/settings-store';

describe( 'ai settings store', () => {
	let configDir: string;
	let previousDevConfigDir: string | undefined;

	const sharedConfigPath = () => path.join( configDir, 'shared.json' );
	const cliConfigPath = () => path.join( configDir, 'cli.json' );
	const readShared = () => JSON.parse( fs.readFileSync( sharedConfigPath(), 'utf8' ) );

	beforeEach( () => {
		configDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ai-settings-' ) );
		previousDevConfigDir = process.env.DEV_CONFIG_DIR;
		process.env.DEV_CONFIG_DIR = configDir;
		// Selecting the Anthropic provider validates the key; default to "valid".
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

	it( 'defaults to WordPress.com when no config exists', async () => {
		await expect( readAiSettings() ).resolves.toEqual( {
			provider: 'wpcom',
			connections: {
				wpcom: { connected: false, apiKeyPreview: null },
				'anthropic-api-key': { connected: false, apiKeyPreview: null },
				'gemini-api-key': { connected: false, apiKeyPreview: null },
			},
		} );
	} );

	it( 'saves an accepted key to shared.json without changing the provider', async () => {
		const settings = await saveAiProviderApiKey(
			'anthropic-api-key',
			'sk-ant-api03-testkey-abcd1234'
		);

		expect( settings ).toEqual( {
			provider: 'wpcom',
			connections: {
				wpcom: { connected: false, apiKeyPreview: null },
				'anthropic-api-key': { connected: true, apiKeyPreview: 'sk-ant-api03-tes...1234' },
				'gemini-api-key': { connected: false, apiKeyPreview: null },
			},
		} );
		expect( readShared().anthropicApiKey ).toBe( 'sk-ant-api03-testkey-abcd1234' );
		expect( readShared() ).not.toHaveProperty( 'aiProviderCredentials' );
		expect( fs.existsSync( cliConfigPath() ) ).toBe( false );
	} );

	it( 'reads legacy values from cli.json and migrates them on write', async () => {
		fs.writeFileSync(
			cliConfigPath(),
			JSON.stringify( {
				version: 1,
				sites: [],
				snapshots: [],
				aiProvider: 'anthropic-api-key',
				anthropicApiKey: 'sk-ant-api03-legacykey-9999',
			} )
		);

		await expect( readAiSettings() ).resolves.toMatchObject( {
			provider: 'anthropic-api-key',
			connections: { 'anthropic-api-key': { connected: true } },
		} );

		await setAiProvider( 'wpcom' );

		expect( readShared() ).toMatchObject( {
			aiProvider: 'wpcom',
			anthropicApiKey: 'sk-ant-api03-legacykey-9999',
		} );
		expect( readShared() ).not.toHaveProperty( 'aiProviderCredentials' );
	} );

	it( 'keeps the existing key format and preserves other provider credentials', async () => {
		fs.writeFileSync(
			sharedConfigPath(),
			JSON.stringify( {
				version: 1,
				anthropicApiKey: 'sk-ant-api03-legacykey-9999',
				aiProviderCredentials: { 'future-provider': { apiKey: 'future-key' } },
				locale: 'es',
			} )
		);

		await expect( readAiSettings() ).resolves.toMatchObject( {
			connections: {
				'anthropic-api-key': { connected: true, apiKeyPreview: 'sk-ant-api03-leg...9999' },
			},
		} );
		await setAiProvider( 'wpcom' );

		expect( readShared() ).toMatchObject( {
			locale: 'es',
			anthropicApiKey: 'sk-ant-api03-legacykey-9999',
			aiProviderCredentials: {
				'future-provider': { apiKey: 'future-key' },
			},
		} );
	} );

	it( 'does not resurrect a legacy CLI key after disconnecting', async () => {
		const legacy = {
			version: 1,
			aiProvider: 'anthropic-api-key',
			anthropicApiKey: 'sk-ant-api03-legacykey-9999',
		};
		fs.writeFileSync( cliConfigPath(), JSON.stringify( legacy ) );

		await saveAiProviderApiKey( 'anthropic-api-key', null );
		expect( readShared() ).not.toHaveProperty( 'anthropicApiKey' );
		await expect( readAiSettings() ).resolves.toMatchObject( {
			provider: 'wpcom',
			connections: { 'anthropic-api-key': { connected: false, apiKeyPreview: null } },
		} );
		await expect( setAiProvider( 'anthropic-api-key' ) ).rejects.toBeInstanceOf(
			InvalidAiProviderCredentialsError
		);
		await setAiProvider( 'wpcom' );
		await expect( readAiSettings() ).resolves.toMatchObject( {
			connections: { 'anthropic-api-key': { connected: false, apiKeyPreview: null } },
		} );
		expect( JSON.parse( fs.readFileSync( cliConfigPath(), 'utf8' ) ) ).toEqual( legacy );
	} );

	it.each( [ 'sk-ant-api03-testkey-abcd1234', null ] )(
		'rejects API key changes for an account provider (%s)',
		async ( key ) => {
			await expect( saveAiProviderApiKey( 'wpcom', key ) ).rejects.toBeInstanceOf(
				InvalidAiProviderCredentialsError
			);
			expect( fs.existsSync( sharedConfigPath() ) ).toBe( false );
		}
	);

	it( 'does not store a key Anthropic rejects, but stores an unverifiable one', async () => {
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: false, status: 401 } ) );
		await expect(
			saveAiProviderApiKey( 'anthropic-api-key', 'sk-ant-api03-rejected' )
		).rejects.toBeInstanceOf( InvalidAiProviderCredentialsError );
		await expect( readAiSettings() ).resolves.toMatchObject( {
			connections: { 'anthropic-api-key': { connected: false } },
		} );
		expect( fs.existsSync( sharedConfigPath() ) ).toBe( false );

		vi.stubGlobal( 'fetch', vi.fn().mockRejectedValue( new Error( 'offline' ) ) );
		await expect(
			saveAiProviderApiKey( 'anthropic-api-key', 'sk-ant-api03-testkey-abcd1234' )
		).resolves.toMatchObject( {
			connections: { 'anthropic-api-key': { connected: true } },
		} );
	} );

	it( 'selects the Anthropic provider once its key is accepted', async () => {
		await saveAiProviderApiKey( 'anthropic-api-key', 'sk-ant-api03-testkey-abcd1234' );

		await expect( setAiProvider( 'anthropic-api-key' ) ).resolves.toMatchObject( {
			provider: 'anthropic-api-key',
		} );
		expect( readShared().aiProvider ).toBe( 'anthropic-api-key' );
	} );

	it( 'refuses the Anthropic provider without a saved key', async () => {
		await expect( setAiProvider( 'anthropic-api-key' ) ).rejects.toBeInstanceOf(
			InvalidAiProviderCredentialsError
		);
	} );

	it( 'clears the key, falls back to WordPress.com, and preserves unrelated fields', async () => {
		fs.writeFileSync(
			sharedConfigPath(),
			JSON.stringify( {
				version: 1,
				anthropicApiKey: 'sk-ant-api03-testkey-abcd1234',
				aiProvider: 'anthropic-api-key',
				locale: 'es',
			} )
		);

		const settings = await saveAiProviderApiKey( 'anthropic-api-key', null );

		expect( settings ).toEqual( {
			provider: 'wpcom',
			connections: {
				wpcom: { connected: false, apiKeyPreview: null },
				'anthropic-api-key': { connected: false, apiKeyPreview: null },
				'gemini-api-key': { connected: false, apiKeyPreview: null },
			},
		} );
		const written = readShared();
		expect( written.anthropicApiKey ).toBeUndefined();
		expect( written ).toMatchObject( { aiProvider: 'wpcom', locale: 'es' } );
	} );

	it( 'trims the key and treats a blank one as cleared', async () => {
		const settings = await saveAiProviderApiKey(
			'anthropic-api-key',
			'  sk-ant-api03-testkey-abcd1234  '
		);
		expect( settings.connections[ 'anthropic-api-key' ].apiKeyPreview ).toBe(
			'sk-ant-api03-tes...1234'
		);
		expect( readShared().anthropicApiKey ).toBe( 'sk-ant-api03-testkey-abcd1234' );

		await expect( saveAiProviderApiKey( 'anthropic-api-key', '   ' ) ).resolves.toMatchObject( {
			connections: { 'anthropic-api-key': { connected: false } },
			provider: 'wpcom',
		} );
	} );

	it( 'previews a short key by its tail only, never most of the key', async () => {
		const settings = await saveAiProviderApiKey( 'anthropic-api-key', 'sk-short-key-1234' );

		expect( settings.connections[ 'anthropic-api-key' ].apiKeyPreview ).toBe( '...1234' );
	} );

	it( 'refuses a rejected key on switch but accepts an unverifiable one', async () => {
		await saveAiProviderApiKey( 'anthropic-api-key', 'sk-ant-api03-testkey-abcd1234' );

		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: false, status: 401 } ) );
		await expect( setAiProvider( 'anthropic-api-key' ) ).rejects.toBeInstanceOf(
			InvalidAiProviderCredentialsError
		);
		await expect( readAiSettings() ).resolves.toMatchObject( { provider: 'wpcom' } );

		vi.stubGlobal( 'fetch', vi.fn().mockRejectedValue( new Error( 'offline' ) ) );
		await expect( setAiProvider( 'anthropic-api-key' ) ).resolves.toMatchObject( {
			provider: 'anthropic-api-key',
		} );
	} );

	it( 'treats an unknown stored provider as the default', async () => {
		fs.writeFileSync(
			cliConfigPath(),
			JSON.stringify( { version: 1, aiProvider: 'claude-code' } )
		);

		await expect( readAiSettings() ).resolves.toMatchObject( { provider: 'wpcom' } );
	} );

	it( 'stores, selects, and clears a Gemini API key independently of Anthropic', async () => {
		await saveAiProviderApiKey( 'anthropic-api-key', 'sk-ant-api03-testkey-abcd1234' );
		const withBoth = await saveAiProviderApiKey( 'gemini-api-key', 'AIzaSyGeminiTestKeyValue9876' );

		expect( withBoth.connections[ 'gemini-api-key' ] ).toEqual( {
			connected: true,
			apiKeyPreview: 'AIzaSyGeminiTest...9876',
		} );
		expect( withBoth.connections[ 'anthropic-api-key' ].connected ).toBe( true );
		expect( readShared().aiProviderCredentials?.[ 'gemini-api-key' ] ).toEqual( {
			apiKey: 'AIzaSyGeminiTestKeyValue9876',
		} );

		await expect( setAiProvider( 'gemini-api-key' ) ).resolves.toMatchObject( {
			provider: 'gemini-api-key',
		} );

		// Clearing Anthropic keeps Gemini active.
		const afterClearingAnthropic = await saveAiProviderApiKey( 'anthropic-api-key', null );
		expect( afterClearingAnthropic.provider ).toBe( 'gemini-api-key' );
		expect( afterClearingAnthropic.connections[ 'gemini-api-key' ].connected ).toBe( true );

		// Clearing Gemini resets provider to wpcom.
		const afterClearingGemini = await saveAiProviderApiKey( 'gemini-api-key', null );
		expect( afterClearingGemini.provider ).toBe( 'wpcom' );
		expect( afterClearingGemini.connections[ 'gemini-api-key' ] ).toEqual( {
			connected: false,
			apiKeyPreview: null,
		} );
	} );
} );
