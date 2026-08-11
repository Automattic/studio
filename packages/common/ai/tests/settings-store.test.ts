import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	InvalidAnthropicApiKeyError,
	readAiSettings,
	saveAnthropicApiKey,
	setAiProvider,
} from '../settings-store';

describe( 'ai settings store', () => {
	let configDir: string;
	let previousDevConfigDir: string | undefined;

	const cliConfigPath = () => path.join( configDir, 'cli.json' );

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
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		} );
	} );

	it( 'saves an accepted key without changing the provider', async () => {
		const settings = await saveAnthropicApiKey( 'sk-ant-api03-testkey-abcd1234' );

		expect( settings ).toEqual( {
			provider: 'wpcom',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: 'sk-ant-api03-tes...1234',
		} );
		expect( JSON.parse( fs.readFileSync( cliConfigPath(), 'utf8' ) ).anthropicApiKey ).toBe(
			'sk-ant-api03-testkey-abcd1234'
		);
	} );

	it( 'does not store a key Anthropic rejects, but stores an unverifiable one', async () => {
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: false, status: 401 } ) );
		await expect( saveAnthropicApiKey( 'sk-ant-api03-rejected' ) ).rejects.toBeInstanceOf(
			InvalidAnthropicApiKeyError
		);
		await expect( readAiSettings() ).resolves.toMatchObject( { hasAnthropicApiKey: false } );

		vi.stubGlobal( 'fetch', vi.fn().mockRejectedValue( new Error( 'offline' ) ) );
		await expect( saveAnthropicApiKey( 'sk-ant-api03-testkey-abcd1234' ) ).resolves.toMatchObject( {
			hasAnthropicApiKey: true,
		} );
	} );

	it( 'selects the Anthropic provider once its key is accepted', async () => {
		await saveAnthropicApiKey( 'sk-ant-api03-testkey-abcd1234' );

		await expect( setAiProvider( 'anthropic-api-key' ) ).resolves.toMatchObject( {
			provider: 'anthropic-api-key',
		} );
		expect( JSON.parse( fs.readFileSync( cliConfigPath(), 'utf8' ) ).aiProvider ).toBe(
			'anthropic-api-key'
		);
	} );

	it( 'refuses the Anthropic provider without a saved key', async () => {
		await expect( setAiProvider( 'anthropic-api-key' ) ).rejects.toBeInstanceOf(
			InvalidAnthropicApiKeyError
		);
	} );

	it( 'clears the key, falls back to WordPress.com, and preserves unrelated fields', async () => {
		fs.writeFileSync(
			cliConfigPath(),
			JSON.stringify( {
				version: 1,
				sites: [ { id: 'site-1' } ],
				snapshots: [],
				anthropicApiKey: 'sk-ant-api03-testkey-abcd1234',
				aiProvider: 'anthropic-api-key',
				customField: 'kept',
			} )
		);

		const settings = await saveAnthropicApiKey( null );

		expect( settings ).toEqual( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		} );
		const written = JSON.parse( fs.readFileSync( cliConfigPath(), 'utf8' ) );
		expect( written.anthropicApiKey ).toBeUndefined();
		expect( written ).toMatchObject( {
			aiProvider: 'wpcom',
			sites: [ { id: 'site-1' } ],
			customField: 'kept',
		} );
	} );

	it( 'trims the key and treats a blank one as cleared', async () => {
		const settings = await saveAnthropicApiKey( '  sk-ant-api03-testkey-abcd1234  ' );
		expect( settings.anthropicApiKeyPreview ).toBe( 'sk-ant-api03-tes...1234' );
		expect( JSON.parse( fs.readFileSync( cliConfigPath(), 'utf8' ) ).anthropicApiKey ).toBe(
			'sk-ant-api03-testkey-abcd1234'
		);

		await expect( saveAnthropicApiKey( '   ' ) ).resolves.toMatchObject( {
			hasAnthropicApiKey: false,
			provider: 'wpcom',
		} );
	} );

	it( 'refuses a rejected key on switch but accepts an unverifiable one', async () => {
		await saveAnthropicApiKey( 'sk-ant-api03-testkey-abcd1234' );

		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: false, status: 401 } ) );
		await expect( setAiProvider( 'anthropic-api-key' ) ).rejects.toBeInstanceOf(
			InvalidAnthropicApiKeyError
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
} );
