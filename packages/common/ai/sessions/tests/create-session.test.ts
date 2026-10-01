import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAiSession, listAiSessions, loadAiSession, readPiFileEntries } from '../store';

describe( 'createAiSession', () => {
	let rootDirectory: string | undefined;

	afterEach( async () => {
		if ( rootDirectory ) {
			await fs.rm( rootDirectory, { recursive: true, force: true } );
			rootDirectory = undefined;
		}
	} );

	it( 'writes a pi-format session JSONL with site.selected as the active site', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-create-session-' ) );

		const summary = await createAiSession( rootDirectory, {
			site: { id: 'site-1', name: 'My Site', path: '/tmp/my-site' },
		} );

		expect( summary.ownerSiteId ).toBeUndefined();
		expect( summary.ownerSitePath ).toBeUndefined();
		expect( summary.ownerSiteName ).toBeUndefined();
		expect( summary.selectedSiteName ).toBe( 'My Site' );
		expect( summary.activeEnvironment ).toBe( 'local' );
		expect( summary.firstPrompt ).toBeUndefined();

		const listed = await listAiSessions( rootDirectory );
		expect( listed.map( ( s ) => s.id ) ).toContain( summary.id );

		const entries = await readPiFileEntries( summary.filePath );
		// Pi-format file: header is the first line; the studio.site_selected
		// custom entry is the second.
		expect( entries[ 0 ] ).toMatchObject( { type: 'session', version: 3, id: summary.id } );
		expect( entries[ 1 ] ).toMatchObject( {
			type: 'custom',
			customType: 'studio.site_selected',
			data: { siteId: 'site-1', siteName: 'My Site', sitePath: '/tmp/my-site' },
		} );
	} );

	it( 'loads a session by id prefix, including files named off-contract', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-create-session-' ) );
		const created = await createAiSession( rootDirectory );
		const renamed = path.join( rootDirectory, 'renamed.jsonl' );
		const other = await createAiSession( rootDirectory );
		await fs.rename( other.filePath, renamed );

		const byPrefix = await loadAiSession( rootDirectory, created.id.slice( 0, 8 ) );
		expect( byPrefix.summary.filePath ).toBe( created.filePath );

		const offContract = await loadAiSession( rootDirectory, other.id );
		expect( offContract.summary.filePath ).toBe( renamed );
	} );
} );
