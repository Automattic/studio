import fs from 'fs';
import { readFile, writeFile } from 'atomically';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveAiSessionsForSite } from '@studio/common/ai/sessions/manage';
import {
	setAiSessionSitePlacement,
	readAiSessionPlacements,
} from '@studio/common/ai/sessions/placement';
import { readSharedSessions, updateSharedSession } from '@studio/common/lib/shared-config';

// In-memory stand-ins for app.json (placements) and shared.json (star/archive
// flags), keyed by path — both go through `atomically`. Lockfiles are no-ops,
// and the automocked `fs` makes `arePathsEqual` fall back to string comparison.
vi.mock( 'fs' );
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

describe( 'archiveAiSessionsForSite', () => {
	let files: Map< string, string >;

	beforeEach( () => {
		files = new Map();
		vi.mocked( fs.existsSync ).mockImplementation( ( filePath ) =>
			files.has( String( filePath ) )
		);
		vi.mocked( readFile ).mockImplementation( ( async ( filePath: string ) => {
			const content = files.get( String( filePath ) );
			if ( content === undefined ) {
				const error = new Error( 'ENOENT' ) as NodeJS.ErrnoException;
				error.code = 'ENOENT';
				throw error;
			}
			return content;
		} ) as never );
		vi.mocked( writeFile ).mockImplementation( ( async ( filePath: string, data: unknown ) => {
			files.set( String( filePath ), String( data ) );
		} ) as never );
	} );

	const placeSession = ( sessionId: string, siteId: string, sitePath: string ) =>
		setAiSessionSitePlacement( sessionId, { siteId, sitePath, siteName: 'Site' } );

	it( 'archives sessions matching by site id or path, leaving others untouched', async () => {
		await placeSession( 'session-both', 'site-1', '/sites/one' );
		await placeSession( 'session-by-path', 'other-id', '/sites/one' );
		await placeSession( 'session-by-id', 'site-1', '/sites/moved' );
		await placeSession( 'session-unrelated', 'other-id', '/sites/other' );

		const archived = await archiveAiSessionsForSite( { id: 'site-1', path: '/sites/one' } );

		expect( archived.sort() ).toEqual( [ 'session-both', 'session-by-id', 'session-by-path' ] );
		await expect( readSharedSessions() ).resolves.toEqual( {
			'session-both': { archived: true },
			'session-by-path': { archived: true },
			'session-by-id': { archived: true },
		} );
	} );

	it( 'keeps placements and existing session metadata intact', async () => {
		await placeSession( 'session-1', 'site-1', '/sites/one' );
		await updateSharedSession( 'session-1', { starred: true } );

		await archiveAiSessionsForSite( { id: 'site-1', path: '/sites/one' } );

		await expect( readSharedSessions() ).resolves.toEqual( {
			'session-1': { starred: true, archived: true },
		} );
		const placements = await readAiSessionPlacements();
		expect( placements[ 'session-1' ] ).toMatchObject( { siteId: 'site-1' } );
	} );

	it( 'returns no ids and writes nothing when no session belongs to the site', async () => {
		await placeSession( 'session-1', 'other-id', '/sites/other' );
		vi.mocked( writeFile ).mockClear();

		await expect(
			archiveAiSessionsForSite( { id: 'site-1', path: '/sites/one' } )
		).resolves.toEqual( [] );
		expect( writeFile ).not.toHaveBeenCalled();
	} );
} );
