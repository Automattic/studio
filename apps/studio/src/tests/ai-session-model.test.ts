/**
 * @vitest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { appendModelChangeEntry, appendStudioEntry } from '@studio/agent/node/sessions/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listAiProviderModels, setAiSessionModel, setAiSessionProvider } from 'src/ipc-handlers';
import type { IpcMainInvokeEvent } from 'electron';

vi.mock( 'src/lib/oauth' );
// The settings are read from a folder of this test's own.
vi.unmock( 'atomically' );
// What the handlers write to the session; the store's own tests cover writing it.
vi.mock( '@studio/agent/node/sessions/store', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/agent/node/sessions/store') >() ),
	appendModelChangeEntry: vi.fn(),
	appendStudioEntry: vi.fn(),
} ) );

const event = {} as IpcMainInvokeEvent;

describe( 'a local model server in the Desktop app', () => {
	let configDir: string;

	beforeEach( () => {
		configDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ai-session-model-' ) );
		vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
		fs.writeFileSync(
			path.join( configDir, 'shared.json' ),
			JSON.stringify( {
				version: 1,
				providerConfigs: {
					'local-llm': {
						method: 'server',
						baseUrl: 'http://127.0.0.1:11434/v1',
						model: 'qwen3:0.6b',
					},
				},
			} )
		);
		// A server that lists two models and says nothing more about them.
		vi.stubGlobal(
			'fetch',
			vi.fn( async ( url: string ) =>
				url === 'http://127.0.0.1:11434/v1/models'
					? Response.json( { data: [ { id: 'qwen3:0.6b' }, { id: 'gemma3:4b' } ] } )
					: new Response( 'Not found', { status: 404 } )
			)
		);
	} );

	afterEach( () => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		fs.rmSync( configDir, { recursive: true, force: true } );
	} );

	it( 'lists the models the server serves now', async () => {
		await expect( listAiProviderModels( event, 'local-llm' ) ).resolves.toEqual( [
			{ id: 'local-llm/qwen3:0.6b', name: 'qwen3:0.6b', supportsImages: false },
			{ id: 'local-llm/gemma3:4b', name: 'gemma3:4b', supportsImages: false },
		] );
	} );

	it( 'pins a chat to a local model, and switches it to another', async () => {
		await expect(
			setAiSessionProvider( event, 'chat', 'local-llm', 'claude-sonnet-5-5' )
		).rejects.toThrow( 'Model claude-sonnet-5-5 is not served by provider local-llm' );

		await setAiSessionProvider( event, 'chat', 'local-llm', 'local-llm/gemma3:4b' );
		expect( appendStudioEntry ).toHaveBeenCalledWith(
			expect.any( String ),
			'chat',
			'studio.session_context',
			{ provider: 'local-llm', model: 'local-llm/gemma3:4b' }
		);

		await setAiSessionModel( event, 'chat', 'local-llm/qwen3:0.6b' );
		expect( appendModelChangeEntry ).toHaveBeenCalledWith(
			expect.any( String ),
			'chat',
			'',
			'local-llm/qwen3:0.6b'
		);
	} );
} );
