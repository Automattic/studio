import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
	deleteSessionMetadata,
	readSessionsMetadata,
	updateSessionMetadata,
} from '../session-metadata';

let configDir: string;

beforeEach( () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-session-metadata-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
} );

afterEach( () => {
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

it( 'merges updates, and prunes cleared fields and empty records', async () => {
	await updateSessionMetadata( 'a', { archived: true, title: 'Mine' } );
	await updateSessionMetadata( 'b', { unread: true } );

	await expect( updateSessionMetadata( 'a', { archived: false, title: ' ' } ) ).resolves.toBe(
		undefined
	);
	await expect( updateSessionMetadata( 'b', { title: 'Theirs' } ) ).resolves.toEqual( {
		unread: true,
		title: 'Theirs',
	} );
	await expect( readSessionsMetadata() ).resolves.toEqual( {
		b: { unread: true, title: 'Theirs' },
	} );

	await deleteSessionMetadata( 'b' );
	await expect( readSessionsMetadata() ).resolves.toEqual( {} );
} );
