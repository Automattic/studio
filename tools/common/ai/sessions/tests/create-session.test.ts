import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAiSession, listAiSessions, readAiSessionEventsFromFile } from '../store';

describe( 'createAiSession', () => {
	let rootDirectory: string | undefined;

	afterEach( async () => {
		if ( rootDirectory ) {
			await fs.rm( rootDirectory, { recursive: true, force: true } );
			rootDirectory = undefined;
		}
	} );

	it( 'writes a discoverable session file with site.selected as the owner site', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-create-session-' ) );

		const summary = await createAiSession( rootDirectory, {
			site: { name: 'My Site', path: '/tmp/my-site' },
		} );

		expect( summary.ownerSitePath ).toBe( '/tmp/my-site' );
		expect( summary.ownerSiteName ).toBe( 'My Site' );
		expect( summary.firstPrompt ).toBeUndefined();
		expect( summary.eventCount ).toBe( 2 );

		const listed = await listAiSessions( rootDirectory );
		expect( listed.map( ( s ) => s.id ) ).toContain( summary.id );

		const events = await readAiSessionEventsFromFile( summary.filePath );
		expect( events[ 0 ].type ).toBe( 'session.started' );
		expect( events[ 1 ].type ).toBe( 'site.selected' );
	} );
} );
