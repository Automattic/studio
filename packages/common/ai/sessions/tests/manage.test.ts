import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHydratedAiSession } from '../manage';
import { readPiFileEntries } from '../store';

// Sessions live in a real temp directory (store.ts uses `fs/promises`), while
// app.json goes through `atomically`, mocked to an in-memory string — same
// setup as placement.test.ts.
vi.mock( 'atomically', () => ( {
	readFile: vi.fn(),
	writeFile: vi.fn(),
} ) );
vi.mock( 'node:fs/promises', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('node:fs/promises') >();
	const mkdir = vi.fn().mockResolvedValue( undefined );
	return { ...actual, default: { ...actual, mkdir }, mkdir };
} );
vi.mock( '@studio/common/lib/lockfile', () => ( {
	lockFileAsync: vi.fn().mockResolvedValue( undefined ),
	unlockFileAsync: vi.fn().mockResolvedValue( undefined ),
} ) );
vi.mock( '@studio/common/lib/shared-config', () => ( {
	readSharedSession: vi.fn().mockResolvedValue( undefined ),
	readSharedSessions: vi.fn().mockResolvedValue( {} ),
} ) );

describe( 'createHydratedAiSession', () => {
	let rootDirectory: string;
	let appConfigFile: string | undefined;

	const site = { id: 'site-a', name: 'Site A', path: '/sites/my-site' };

	beforeEach( async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-manage-' ) );
		appConfigFile = undefined;
		vi.mocked( readFile ).mockImplementation( ( async () => {
			if ( appConfigFile === undefined ) {
				const error = new Error( 'ENOENT' ) as NodeJS.ErrnoException;
				error.code = 'ENOENT';
				throw error;
			}
			return appConfigFile;
		} ) as never );
		vi.mocked( writeFile ).mockImplementation( ( async ( _path: string, data: unknown ) => {
			appConfigFile = String( data );
		} ) as never );
	} );

	afterEach( async () => {
		await fs.rm( rootDirectory, { recursive: true, force: true } );
	} );

	it( 'binds a new session to the site', async () => {
		const created = await createHydratedAiSession( rootDirectory, { site } );
		expect( created.ownerSiteId ).toBe( 'site-a' );

		// The initial site_selected event records the id so turn dispatch can
		// resolve the site by id instead of path.
		const entries = await readPiFileEntries( created.filePath );
		expect( entries[ 1 ] ).toMatchObject( {
			customType: 'studio.site_selected',
			data: { siteId: 'site-a', sitePath: site.path },
		} );

		const again = await createHydratedAiSession( rootDirectory, { site } );
		expect( again.id ).not.toBe( created.id );
	} );
} );
