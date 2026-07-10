import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAiSession, deleteAiSession, listAiSessions } from '../store';

describe( 'deleteAiSession', () => {
	let rootDirectory: string | undefined;

	afterEach( async () => {
		if ( rootDirectory ) {
			await fs.rm( rootDirectory, { recursive: true, force: true } );
			rootDirectory = undefined;
		}
	} );

	it( 'removes the session file along with sidecar files and directories', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-delete-session-' ) );

		const summary = await createAiSession( rootDirectory, {
			site: { name: 'My Site', path: '/tmp/my-site' },
		} );

		const stem = summary.filePath.slice( 0, -'.jsonl'.length );
		const screenshotsDirectory = `${ stem }.screenshots`;
		await fs.mkdir( screenshotsDirectory, { recursive: true } );
		await fs.writeFile( path.join( screenshotsDirectory, 'screenshot-desktop.jpg' ), 'jpeg' );
		await fs.writeFile( `${ stem }.openai-state.json`, '{}' );

		await deleteAiSession( rootDirectory, summary.id );

		await expect( fs.access( summary.filePath ) ).rejects.toThrow();
		await expect( fs.access( screenshotsDirectory ) ).rejects.toThrow();
		await expect( fs.access( `${ stem }.openai-state.json` ) ).rejects.toThrow();
		await expect( listAiSessions( rootDirectory ) ).resolves.toEqual( [] );
	} );
} );
