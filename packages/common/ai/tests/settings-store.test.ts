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

	const cliConfigPath = () => path.join( configDir, 'cli.json' );

	beforeEach( () => {
		configDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ai-settings-' ) );
		previousDevConfigDir = process.env.DEV_CONFIG_DIR;
		process.env.DEV_CONFIG_DIR = configDir;
		// Saving validates the key against Anthropic; default to "valid".
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
			anthropicApiKeySuffix: null,
		} );
	} );

	it( 'saves a key, switches the provider, and never returns the key', async () => {
		const settings = await saveAnthropicApiKey( 'sk-ant-test-abcd1234' );

		expect( settings ).toEqual( {
			provider: 'anthropic-api-key',
			hasAnthropicApiKey: true,
			anthropicApiKeySuffix: '1234',
		} );
		expect( JSON.parse( fs.readFileSync( cliConfigPath(), 'utf8' ) ) ).toMatchObject( {
			aiProvider: 'anthropic-api-key',
			anthropicApiKey: 'sk-ant-test-abcd1234',
		} );
	} );

	it( 'clears the key, falls back to WordPress.com, and preserves unrelated fields', async () => {
		fs.writeFileSync(
			cliConfigPath(),
			JSON.stringify( {
				version: 1,
				sites: [ { id: 'site-1' } ],
				snapshots: [],
				anthropicApiKey: 'sk-ant-test-abcd1234',
				aiProvider: 'anthropic-api-key',
				customField: 'kept',
			} )
		);

		const settings = await saveAnthropicApiKey( null );

		expect( settings ).toEqual( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeySuffix: null,
		} );
		const written = JSON.parse( fs.readFileSync( cliConfigPath(), 'utf8' ) );
		expect( written.anthropicApiKey ).toBeUndefined();
		expect( written ).toMatchObject( {
			aiProvider: 'wpcom',
			sites: [ { id: 'site-1' } ],
			customField: 'kept',
		} );
	} );

	it( 'trims the key and rejects an empty one', async () => {
		const settings = await saveAnthropicApiKey( '  sk-ant-test-abcd1234  ' );
		expect( settings.anthropicApiKeySuffix ).toBe( '1234' );
		expect( JSON.parse( fs.readFileSync( cliConfigPath(), 'utf8' ) ).anthropicApiKey ).toBe(
			'sk-ant-test-abcd1234'
		);

		await expect( saveAnthropicApiKey( '   ' ) ).rejects.toThrow( 'must not be empty' );
	} );

	it( 'refuses a key Anthropic rejects and saves one it cannot verify', async () => {
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: false, status: 401 } ) );
		await expect( saveAnthropicApiKey( 'sk-ant-rejected' ) ).rejects.toBeInstanceOf(
			InvalidAnthropicApiKeyError
		);
		expect( fs.existsSync( cliConfigPath() ) ).toBe( false );

		vi.stubGlobal( 'fetch', vi.fn().mockRejectedValue( new Error( 'offline' ) ) );
		await expect( saveAnthropicApiKey( 'sk-ant-test-abcd1234' ) ).resolves.toMatchObject( {
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
