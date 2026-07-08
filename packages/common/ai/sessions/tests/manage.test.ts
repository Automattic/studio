import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOrReuseAiSession } from '../manage';

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

describe( 'createOrReuseAiSession', () => {
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

	it( 'reuses an empty draft only when the site id matches', async () => {
		const first = await createOrReuseAiSession( rootDirectory, { site } );
		expect( first.ownerSiteId ).toBe( 'site-a' );

		const again = await createOrReuseAiSession( rootDirectory, { site } );
		expect( again.id ).toBe( first.id );

		// A new site recreated at the same path must not inherit the old
		// site's draft.
		const successor = { id: 'site-b', name: 'Site B', path: site.path };
		const other = await createOrReuseAiSession( rootDirectory, { site: successor } );
		expect( other.id ).not.toBe( first.id );
		expect( other.ownerSiteId ).toBe( 'site-b' );
	} );

	it( 'falls back to path matching when the placement lacks a site id', async () => {
		const created = await createOrReuseAiSession( rootDirectory, { site } );

		const config = JSON.parse( appConfigFile! ) as {
			aiSessionPlacements: Record< string, { siteId?: string } >;
		};
		delete config.aiSessionPlacements[ created.id ].siteId;
		appConfigFile = JSON.stringify( config );

		const reused = await createOrReuseAiSession( rootDirectory, { site } );
		expect( reused.id ).toBe( created.id );
	} );
} );
