import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishDirectoryToSpacefast } from '@studio/common/lib/spacefast/api';

type Call = { method: string; path: string; body?: unknown; headers: Record< string, string > };

const SPACE = '/v1/spaces/spc_1';
let calls: Call[];
let directory: string;

function sha256( content: string ) {
	return crypto.createHash( 'sha256' ).update( content ).digest( 'hex' );
}

function json( data: unknown, status = 200 ) {
	return new Response( JSON.stringify( data ), { status } );
}

// A fake Spacefast that asks for `about/index.html` on the first page of upload
// targets, `style.css` on the second, and reports the version ready once finalized.
function mockSpacefast( { versionId = 'ver_1' }: { versionId?: string | null } = {} ) {
	const pages = [ [ 'about/index.html' ], [ 'style.css' ], [] ];
	const uploadPage = () => {
		const paths = pages.shift() ?? [];
		return {
			summary: { upload: 2 },
			targets: paths.map( ( p ) => ( { path: p, method: 'PUT', url: `/uploads/${ p }` } ) ),
		};
	};
	vi.stubGlobal(
		'fetch',
		vi.fn( async ( url: URL, init: RequestInit ) => {
			const method = init.method ?? 'GET';
			const body = typeof init.body === 'string' ? JSON.parse( init.body ) : init.body?.toString();
			calls.push( {
				method,
				path: url.pathname,
				body,
				headers: ( init.headers ?? {} ) as Record< string, string >,
			} );
			if ( url.pathname === `${ SPACE }/versions` ) {
				return json( { data: { versionId, upload: versionId ? uploadPage() : null } } );
			}
			if ( url.pathname.endsWith( '/uploads/refresh' ) ) {
				return json( { data: { versionId, upload: uploadPage() } } );
			}
			if ( url.pathname.startsWith( '/uploads/' ) ) {
				return new Response( null, { status: 200 } );
			}
			if ( url.pathname.endsWith( '/finalize' ) ) {
				return json( { data: { status: 'finalizing' } } );
			}
			return json( { data: { status: 'ready', failureMessage: null } } );
		} )
	);
}

beforeEach( () => {
	calls = [];
	directory = fs.mkdtempSync( path.join( os.tmpdir(), 'spacefast-api-' ) );
	fs.mkdirSync( path.join( directory, 'about' ) );
	fs.writeFileSync( path.join( directory, 'index.html' ), 'home' );
	fs.writeFileSync( path.join( directory, 'about', 'index.html' ), 'about' );
	fs.writeFileSync( path.join( directory, 'style.css' ), 'body{}' );
} );

afterEach( () => {
	vi.unstubAllGlobals();
	fs.rmSync( directory, { recursive: true, force: true } );
} );

function publish( onProgress?: ( progress: { uploaded: number; total: number } ) => void ) {
	return publishDirectoryToSpacefast( 'sfa_key', 'spc_1', directory, onProgress );
}

describe( 'publishDirectoryToSpacefast', () => {
	it( 'uploads the files Spacefast requests, then finalizes the version live', async () => {
		mockSpacefast();
		const progress: number[] = [];

		expect( await publish( ( { uploaded } ) => progress.push( uploaded ) ) ).toEqual( {
			versionId: 'ver_1',
		} );

		expect( calls[ 0 ].body ).toMatchObject( {
			publishMode: 'snapshot',
			files: [
				{ path: 'about/index.html', size: 5, sha256: sha256( 'about' ) },
				{ path: 'index.html', size: 4, sha256: sha256( 'home' ) },
				{ path: 'style.css', size: 6, sha256: sha256( 'body{}' ) },
			],
		} );
		expect( calls.filter( ( call ) => call.path.startsWith( '/uploads/' ) ) ).toEqual( [
			expect.objectContaining( { path: '/uploads/about/index.html', body: 'about' } ),
			expect.objectContaining( { path: '/uploads/style.css', body: 'body{}' } ),
		] );
		expect( calls.find( ( call ) => call.path.endsWith( '/finalize' ) )?.body ).toEqual( {
			channel: 'live',
		} );
		expect( progress ).toEqual( [ 0, 1, 2 ] );
	} );

	it( 'skips uploading and finalizing when nothing changed', async () => {
		mockSpacefast( { versionId: null } );

		expect( await publish() ).toEqual( { versionId: null } );
		expect( calls.map( ( call ) => call.path ) ).toEqual( [ `${ SPACE }/versions` ] );
	} );

	it( 'retries a request that never reached Spacefast with the same idempotency key', async () => {
		mockSpacefast();
		const reachable = vi.mocked( fetch ).getMockImplementation()!;
		vi.mocked( fetch ).mockImplementationOnce( async ( url, init ) => {
			calls.push( {
				method: 'POST',
				path: 'network-error',
				headers: ( init?.headers ?? {} ) as Record< string, string >,
			} );
			throw new TypeError( 'fetch failed' );
		} );
		vi.mocked( fetch ).mockImplementation( reachable );

		await publish();

		const [ failed, retried ] = calls;
		expect( retried.path ).toBe( `${ SPACE }/versions` );
		expect( retried.headers[ 'Idempotency-Key' ] ).toBe( failed.headers[ 'Idempotency-Key' ] );
	} );
} );
