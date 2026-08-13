import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	InvalidAnthropicApiKeyError,
	readAiSettings,
	saveAnthropicApiKey,
} from '../settings-store';

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
		// Saving a key validates it against Anthropic; default to "valid".
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

	it( 'saves an accepted key to shared.json without changing the provider', async () => {
		const settings = await saveAnthropicApiKey( 'sk-ant-api03-testkey-abcd1234' );

		expect( settings ).toEqual( {
			provider: 'wpcom',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: 'sk-ant-api03-tes...1234',
		} );
		expect( readShared().anthropicApiKey ).toBe( 'sk-ant-api03-testkey-abcd1234' );
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
			hasAnthropicApiKey: true,
		} );

		await saveAnthropicApiKey( 'sk-ant-api03-newkey-0000' );

		expect( readShared() ).toMatchObject( {
			aiProvider: 'anthropic-api-key',
			anthropicApiKey: 'sk-ant-api03-newkey-0000',
		} );
	} );

	it( 'does not store a key Anthropic rejects, but stores an unverifiable one', async () => {
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: false, status: 401 } ) );
		await expect( saveAnthropicApiKey( 'sk-ant-api03-rejected' ) ).rejects.toBeInstanceOf(
			InvalidAnthropicApiKeyError
		);
		await expect( readAiSettings() ).resolves.toMatchObject( { hasAnthropicApiKey: false } );
		expect( fs.existsSync( sharedConfigPath() ) ).toBe( false );

		vi.stubGlobal( 'fetch', vi.fn().mockRejectedValue( new Error( 'offline' ) ) );
		await expect( saveAnthropicApiKey( 'sk-ant-api03-testkey-abcd1234' ) ).resolves.toMatchObject( {
			hasAnthropicApiKey: true,
		} );
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

		const settings = await saveAnthropicApiKey( null );

		expect( settings ).toEqual( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		} );
		const written = readShared();
		expect( written.anthropicApiKey ).toBeUndefined();
		expect( written ).toMatchObject( { aiProvider: 'wpcom', locale: 'es' } );
	} );

	it( 'trims the key and treats a blank one as cleared', async () => {
		const settings = await saveAnthropicApiKey( '  sk-ant-api03-testkey-abcd1234  ' );
		expect( settings.anthropicApiKeyPreview ).toBe( 'sk-ant-api03-tes...1234' );
		expect( readShared().anthropicApiKey ).toBe( 'sk-ant-api03-testkey-abcd1234' );

		await expect( saveAnthropicApiKey( '   ' ) ).resolves.toMatchObject( {
			hasAnthropicApiKey: false,
			provider: 'wpcom',
		} );
	} );

	it( 'previews a short key by its tail only, never most of the key', async () => {
		const settings = await saveAnthropicApiKey( 'sk-short-key-1234' );

		expect( settings.anthropicApiKeyPreview ).toBe( '...1234' );
	} );

	it( 'treats an unknown stored provider as the default', async () => {
		fs.writeFileSync(
			cliConfigPath(),
			JSON.stringify( { version: 1, aiProvider: 'claude-code' } )
		);

		await expect( readAiSettings() ).resolves.toMatchObject( { provider: 'wpcom' } );
	} );
} );
