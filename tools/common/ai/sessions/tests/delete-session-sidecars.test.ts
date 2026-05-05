import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAiSession, deleteAiSession } from '../store';

describe( 'deleteAiSession sweeps sibling sidecar files', () => {
	let rootDirectory: string | undefined;

	afterEach( async () => {
		if ( rootDirectory ) {
			await fs.rm( rootDirectory, { recursive: true, force: true } );
			rootDirectory = undefined;
		}
	} );

	it( 'deletes sibling files sharing the JSONL stem (e.g. .openai-state.json)', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-delete-sidecar-' ) );

		const summary = await createAiSession( rootDirectory, {
			site: { name: 'Site', path: '/tmp/site' },
		} );

		// Drop a sidecar next to the JSONL the same way the OpenAI runtime does.
		const sidecarPath = summary.filePath.replace( /\.jsonl$/, '.openai-state.json' );
		await fs.writeFile( sidecarPath, '[]' );

		// And a hypothetical future sidecar from another runtime, to confirm
		// the sweep is generic — not pinned to the OpenAI suffix.
		const futureSidecar = summary.filePath.replace( /\.jsonl$/, '.notes.json' );
		await fs.writeFile( futureSidecar, '{}' );

		// Sanity: both files exist before delete.
		await expect( fs.access( sidecarPath ) ).resolves.toBeUndefined();
		await expect( fs.access( futureSidecar ) ).resolves.toBeUndefined();

		await deleteAiSession( rootDirectory, summary.id );

		// JSONL gone (the basic contract).
		await expect( fs.access( summary.filePath ) ).rejects.toThrow();
		// Sidecars also gone — no orphans.
		await expect( fs.access( sidecarPath ) ).rejects.toThrow();
		await expect( fs.access( futureSidecar ) ).rejects.toThrow();
	} );

	it( 'leaves unrelated session files in the same directory untouched', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-delete-sidecar-' ) );

		const a = await createAiSession( rootDirectory, {
			site: { name: 'Site', path: '/tmp/site' },
		} );
		const b = await createAiSession( rootDirectory, {
			site: { name: 'Site', path: '/tmp/site' },
		} );

		// Sidecar for B — must NOT be deleted when A goes away.
		const bSidecar = b.filePath.replace( /\.jsonl$/, '.openai-state.json' );
		await fs.writeFile( bSidecar, '[]' );

		await deleteAiSession( rootDirectory, a.id );

		await expect( fs.access( a.filePath ) ).rejects.toThrow();
		await expect( fs.access( b.filePath ) ).resolves.toBeUndefined();
		await expect( fs.access( bSidecar ) ).resolves.toBeUndefined();
	} );
} );
