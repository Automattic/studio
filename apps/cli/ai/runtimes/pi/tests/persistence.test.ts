import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteSidecar, getSidecarPath, loadSidecar, saveSidecar } from '../persistence';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

describe( 'pi runtime sidecar persistence', () => {
	let tempDir: string;

	beforeEach( async () => {
		tempDir = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-pi-sidecar-' ) );
	} );

	afterEach( async () => {
		await fs.rm( tempDir, { recursive: true, force: true } );
	} );

	function makeMessages(): AgentMessage[] {
		return [
			{ role: 'user', content: 'hello', timestamp: 1 },
			{
				role: 'assistant',
				content: [ { type: 'text', text: 'hi back' } ],
				api: 'openai-completions',
				provider: 'openai',
				model: 'gpt-5.5',
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: 'stop',
				timestamp: 2,
			},
		];
	}

	it( 'derives the sidecar path by replacing the .jsonl extension', () => {
		expect( getSidecarPath( '/tmp/foo/2026-04-24-abc.jsonl' ) ).toBe(
			'/tmp/foo/2026-04-24-abc.pi-state.json'
		);
	} );

	it( 'falls back to suffixing when the input has no .jsonl extension', () => {
		expect( getSidecarPath( '/tmp/foo/no-extension' ) ).toBe(
			'/tmp/foo/no-extension.pi-state.json'
		);
	} );

	it( 'returns null when the sidecar does not exist (fresh session)', async () => {
		const jsonlPath = path.join( tempDir, 'session.jsonl' );
		const loaded = await loadSidecar( jsonlPath );
		expect( loaded ).toBeNull();
	} );

	it( 'round-trips messages through save/load', async () => {
		const jsonlPath = path.join( tempDir, 'session.jsonl' );
		const original = makeMessages();
		await saveSidecar( jsonlPath, original );
		const loaded = await loadSidecar( jsonlPath );
		expect( loaded ).toEqual( original );
	} );

	it( 'returns null when the sidecar is malformed JSON', async () => {
		const jsonlPath = path.join( tempDir, 'session.jsonl' );
		await fs.writeFile( getSidecarPath( jsonlPath ), '{not valid json' );
		const loaded = await loadSidecar( jsonlPath );
		expect( loaded ).toBeNull();
	} );

	it( 'returns null when the sidecar is valid JSON but not an array', async () => {
		const jsonlPath = path.join( tempDir, 'session.jsonl' );
		await fs.writeFile( getSidecarPath( jsonlPath ), '{"role":"user","content":"hi"}' );
		const loaded = await loadSidecar( jsonlPath );
		expect( loaded ).toBeNull();
	} );

	it( 'overwrites a prior sidecar atomically (no .tmp leftover)', async () => {
		const jsonlPath = path.join( tempDir, 'session.jsonl' );
		await saveSidecar( jsonlPath, [ { role: 'user', content: 'first', timestamp: 1 } ] );
		await saveSidecar( jsonlPath, [ { role: 'user', content: 'second', timestamp: 2 } ] );
		const loaded = await loadSidecar( jsonlPath );
		expect( loaded ).toEqual( [ { role: 'user', content: 'second', timestamp: 2 } ] );
		const entries = await fs.readdir( tempDir );
		expect( entries ).not.toContain( 'session.pi-state.json.tmp' );
	} );

	it( 'silently no-ops when deleting a non-existent sidecar', async () => {
		const jsonlPath = path.join( tempDir, 'session.jsonl' );
		// Should not throw.
		await deleteSidecar( jsonlPath );
	} );

	it( 'deletes an existing sidecar', async () => {
		const jsonlPath = path.join( tempDir, 'session.jsonl' );
		await saveSidecar( jsonlPath, makeMessages() );
		await deleteSidecar( jsonlPath );
		expect( await loadSidecar( jsonlPath ) ).toBeNull();
	} );

	// Migration coverage: pre-rename sessions wrote their sidecar under the
	// .openai-state.json suffix. The unified loader reads that path as a
	// one-time fallback so resumed sessions don't lose pi memory across the
	// migration. The writer always uses the new suffix.
	it( 'reads from the legacy .openai-state.json suffix when the new one is absent', async () => {
		const jsonlPath = path.join( tempDir, 'session.jsonl' );
		const legacyPath = jsonlPath.replace( /\.jsonl$/, '.openai-state.json' );
		const messages = makeMessages();
		await fs.writeFile( legacyPath, JSON.stringify( messages ), 'utf8' );

		const loaded = await loadSidecar( jsonlPath );
		expect( loaded ).toEqual( messages );
	} );

	it( 'prefers the new .pi-state.json suffix when both exist', async () => {
		const jsonlPath = path.join( tempDir, 'session.jsonl' );
		const newPath = getSidecarPath( jsonlPath );
		const legacyPath = jsonlPath.replace( /\.jsonl$/, '.openai-state.json' );

		await fs.writeFile(
			legacyPath,
			JSON.stringify( [ { role: 'user', content: 'legacy', timestamp: 0 } ] ),
			'utf8'
		);
		await fs.writeFile(
			newPath,
			JSON.stringify( [ { role: 'user', content: 'new', timestamp: 0 } ] ),
			'utf8'
		);

		const loaded = await loadSidecar( jsonlPath );
		expect( loaded ).toEqual( [ { role: 'user', content: 'new', timestamp: 0 } ] );
	} );

	it( 'sweeps both new and legacy sidecars on delete', async () => {
		const jsonlPath = path.join( tempDir, 'session.jsonl' );
		const legacyPath = jsonlPath.replace( /\.jsonl$/, '.openai-state.json' );
		await saveSidecar( jsonlPath, makeMessages() );
		await fs.writeFile( legacyPath, JSON.stringify( makeMessages() ), 'utf8' );

		await deleteSidecar( jsonlPath );
		const entries = await fs.readdir( tempDir );
		expect( entries ).not.toContain( 'session.pi-state.json' );
		expect( entries ).not.toContain( 'session.openai-state.json' );
	} );
} );
