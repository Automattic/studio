import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	appendStudioEntry,
	createAiSession,
	deleteAiSession,
	listAiSessions,
	loadAiSession,
} from '../store';

describe( 'listAiSessions summary cache', () => {
	let rootDirectory: string | undefined;

	afterEach( async () => {
		if ( rootDirectory ) {
			await fs.rm( rootDirectory, { recursive: true, force: true } );
			rootDirectory = undefined;
		}
	} );

	it( 'lists a session immediately after creating it', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-store-' ) );

		const created = await createAiSession( rootDirectory );
		const listed = await listAiSessions( rootDirectory );

		expect( listed.map( ( session ) => session.id ) ).toContain( created.id );
	} );

	it( 'refreshes a cached summary after an append', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-store-' ) );
		const created = await createAiSession( rootDirectory );

		// Prime the cache, then close the turn and relist.
		let [ listed ] = await listAiSessions( rootDirectory );
		expect( listed.endReason ).toBeUndefined();

		await appendStudioEntry( rootDirectory, created.id, 'studio.turn_closed', {
			status: 'error',
		} );

		[ listed ] = await listAiSessions( rootDirectory );
		expect( listed.endReason ).toBe( 'error' );
	} );

	it( 'drops a deleted session from subsequent listings', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-store-' ) );
		const kept = await createAiSession( rootDirectory );
		const removed = await createAiSession( rootDirectory );
		await listAiSessions( rootDirectory );

		await deleteAiSession( rootDirectory, removed.id );

		const listed = await listAiSessions( rootDirectory );
		expect( listed.map( ( session ) => session.id ) ).toEqual( [ kept.id ] );
	} );

	it( 'lists and loads a CR-delimited pi file consistently', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-store-' ) );
		const filePath = path.join( rootDirectory, 'session.jsonl' );
		await fs.writeFile(
			filePath,
			[
				JSON.stringify( {
					type: 'session',
					version: 3,
					id: 'cr-session',
					timestamp: '2026-05-12T17:00:00.000Z',
					cwd: '~/Studio',
				} ),
				JSON.stringify( {
					type: 'custom',
					id: 'entry-1',
					parentId: null,
					customType: 'studio.user_prompt',
					timestamp: '2026-05-12T17:01:00.000Z',
					data: { source: 'prompt', text: 'CR endings' },
				} ),
			].join( '\r' ) + '\r'
		);

		const listed = await listAiSessions( rootDirectory );
		expect( listed.map( ( session ) => session.id ) ).toContain( 'cr-session' );

		const loaded = await loadAiSession( rootDirectory, 'cr-session' );
		expect( loaded.entries ).toHaveLength( 2 );
	} );
} );
