import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readAiSettings, saveAiProviderApiKey, setAiProvider } from '../settings-store';
import type { AiProviderId } from '@studio/agent/protocol/providers';

vi.mock( '@studio/agent/protocol/provider-catalog', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@studio/agent/protocol/provider-catalog') >();
	return {
		...actual,
		AI_PROVIDERS: [
			...actual.AI_PROVIDERS,
			{
				...actual.AI_PROVIDERS[ 1 ],
				id: 'fixture-api',
				label: 'Fixture API',
			},
		],
	};
} );

vi.mock( '@studio/agent/node/providers', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('../providers') >();
	return {
		...actual,
		AI_BACKEND_PROVIDERS: {
			...actual.AI_BACKEND_PROVIDERS,
			'fixture-api': {
				...actual.AI_BACKEND_PROVIDERS[ 'anthropic-api-key' ],
				auth: {
					type: 'api-key',
					getPrompt: () => 'Fixture key',
					getMissingKeyMessage: () => 'Fixture key required',
					validate: async ( key: string ) =>
						key.startsWith( 'fixture-' )
							? { status: 'valid' }
							: { status: 'invalid', message: 'Invalid fixture key' },
				},
			},
		},
	};
} );

const provider = 'fixture-api' as AiProviderId;
let configDir: string;

beforeEach( () => {
	configDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-provider-extension-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
} );

afterEach( () => {
	vi.unstubAllEnvs();
	fs.rmSync( configDir, { recursive: true, force: true } );
} );

it( 'connects, selects and disconnects an additional registered provider', async () => {
	await expect( setAiProvider( provider ) ).rejects.toThrow( 'Fixture key required' );
	await expect( saveAiProviderApiKey( provider, 'not-a-fixture-key' ) ).rejects.toThrow(
		'Invalid fixture key'
	);
	const connected = await saveAiProviderApiKey( provider, 'fixture-provider-secret-1234' );
	expect( connected.connections[ provider ] ).toEqual( {
		connected: true,
		apiKeyPreview: 'fixture-provider...1234',
	} );
	expect( JSON.stringify( connected ) ).not.toContain( 'fixture-provider-secret-1234' );
	expect( ( await setAiProvider( provider ) ).provider ).toBe( provider );
	await saveAiProviderApiKey( 'anthropic-api-key', null );
	expect( ( await readAiSettings() ).provider ).toBe( provider );
	const disconnected = await saveAiProviderApiKey( provider, null );
	expect( disconnected.provider ).toBe( 'wpcom' );
	expect( disconnected.connections[ provider ] ).toEqual( {
		connected: false,
		apiKeyPreview: null,
	} );
} );
