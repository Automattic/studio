import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.ts';
import { UserError } from './guards.ts';
import {
	createPipeline,
	fetchTitle,
	progressFrom,
	siteNameFrom,
	type Session,
} from './pipeline.ts';
import type { JobProgress, JobRecord } from './jobs.ts';

const session = ( state: Session[ 'state' ], progress?: Session[ 'progress' ] ): Session => ( {
	session_id: 'abc',
	state,
	progress,
} );

const json = ( body: unknown, status = 200 ) =>
	new Response( JSON.stringify( body ), {
		status,
		headers: { 'content-type': 'application/json' },
	} );

describe( 'progressFrom', () => {
	it( 'follows the capture, page by page', () => {
		const first = progressFrom( session( 'capturing', { pages_captured: 1, pages_total: 20 } ) );
		expect( first ).toMatchObject( {
			step: 'capture',
			detail: 'Copied 1 of 20 pages',
			counts: { pages: 1 },
		} );
		const last = progressFrom( session( 'capturing', { pages_captured: 20, pages_total: 20 } ) );
		expect( last!.progress ).toBeGreaterThan( first!.progress! );
		expect( last!.progress ).toBeCloseTo( 0.58 );
	} );

	it( 'names the phase while there is nothing to count', () => {
		expect( progressFrom( session( 'capture_queued' ) ) ).toMatchObject( { step: 'scan' } );
		expect( progressFrom( session( 'capturing', { finding_pages: true } ) ) ).toMatchObject( {
			step: 'scan',
			detail: 'Looking at your site…',
		} );
		expect( progressFrom( session( 'building' ) ) ).toMatchObject( { step: 'import' } );
		expect( progressFrom( session( 'preview_ready' ) ) ).toMatchObject( { step: 'package' } );
	} );

	it( 'reports nothing for states the page does not show', () => {
		expect( progressFrom( session( 'failed' ) ) ).toBeUndefined();
	} );
} );

describe( 'fetchTitle', () => {
	afterEach( () => vi.unstubAllGlobals() );

	it( 'reads the title the source page gives itself', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn( async () => new Response( '<html><head><title>Tom &amp; Jerry</title></head>' ) )
		);
		expect( await fetchTitle( 'https://mysite.com/', AbortSignal.timeout( 5_000 ) ) ).toBe(
			'Tom & Jerry'
		);
	} );

	it( 'follows a redirect, and checks where it lands', async () => {
		const seen: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn( async ( url: URL ) => {
				seen.push( url.href );
				return seen.length === 1
					? new Response( null, { status: 301, headers: { location: 'https://www.mysite.com/' } } )
					: new Response( '<title>Acme</title>' );
			} )
		);
		expect( await fetchTitle( 'https://mysite.com/', AbortSignal.timeout( 5_000 ) ) ).toBe(
			'Acme'
		);
		expect( seen ).toEqual( [ 'https://mysite.com/', 'https://www.mysite.com/' ] );
	} );

	it( 'refuses a redirect into a private address', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response( null, { status: 302, headers: { location: 'http://127.0.0.1/' } } )
			)
		);
		await expect(
			fetchTitle( 'https://mysite.com/', AbortSignal.timeout( 5_000 ) )
		).rejects.toThrow();
	} );
} );

describe( 'siteNameFrom', () => {
	it.each( [
		[ 'Sonora', 'Sonora' ],
		[ '  Dopple   Creative Studio ', 'Dopple Creative Studio' ],
		[ 'Home | Acme Coffee', 'Acme Coffee' ],
		[ 'Acme Coffee — Home', 'Acme Coffee' ],
		[ 'Acme Coffee - Fresh roasts daily', 'Acme Coffee' ],
		[ 'Imported Site', undefined ],
		[ 'Home', undefined ],
		[ '', undefined ],
		[ null, undefined ],
		[ 'The pooches of Sonora should get their own catwalk', undefined ],
	] )( 'turns %j into %j', ( title, name ) => {
		expect( siteNameFrom( title ) ).toBe( name );
	} );
} );

describe( 'createPipeline', () => {
	const ZIP = 'a liberated site';
	const HASH = createHash( 'sha256' ).update( ZIP ).digest( 'hex' );

	const ready = ( summary?: Session[ 'preview_summary' ] ): Session => ( {
		session_id: 'abc',
		state: 'preview_ready',
		archive_url: 'https://archives.example.com/site.zip',
		archive_hash: HASH,
		preview_summary: summary,
	} );

	afterEach( () => vi.unstubAllGlobals() );

	it( 'creates a session, follows it, saves the archive and gives the slot back', async () => {
		const calls = stubApi( [
			session( 'capturing', { pages_captured: 4, pages_total: 8 } ),
			ready( { pages: 13, quality_pass: false } ),
		] );
		const { result, progress } = await run();

		expect( result ).toMatchObject( {
			siteName: 'Sonora',
			counts: { pages: 13 },
			warning: expect.stringContaining( 'didn’t convert cleanly' ),
			files: { site: ZIP.length },
		} );
		// The name reaches the page as soon as it is known, before the copy is done.
		expect( progress[ 1 ] ).toEqual( { siteName: 'Sonora' } );
		expect( progress.map( ( step ) => step.step ).filter( Boolean ) ).toEqual( [
			'scan',
			'capture',
			'package',
			'package',
		] );
		expect( calls ).toEqual( [
			'GET https://mysite.com/',
			'POST /oauth2/token',
			'POST /wpcom/v2/static-site-import-preview',
			'GET /wpcom/v2/static-site-import-preview/abc',
			'GET /wpcom/v2/static-site-import-preview/abc',
			'GET https://archives.example.com/site.zip',
			'DELETE /wpcom/v2/static-site-import-preview/abc',
		] );
	} );

	it( 'refuses an archive that does not match the hash it came with', async () => {
		stubApi( [ { ...ready(), archive_hash: 'f'.repeat( 64 ) } ] );
		await expect( run() ).rejects.toThrow( /does not match its hash/ );
	} );

	it( 'tells the visitor to come back later when the app is out of budget', async () => {
		stubApi( [], { code: 'static_site_import_preview_daily_limit', status: 429 } );
		await expect( run() ).rejects.toThrow( UserError );
	} );

	it( 'reports a source it could not copy as the visitor’s answer', async () => {
		stubApi( [ session( 'failed' ) ] );
		await expect( run() ).rejects.toThrow( /couldn’t copy this site/ );
	} );

	it( 'mints a fresh token and retries once when the old one is rejected', async () => {
		let rejected = false;
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn( async ( url: string | URL, options: RequestInit = {} ) => {
				const method = options.method ?? 'GET';
				url = String( url );
				calls.push( `${ method } ${ url.replace( 'https://api.test', '' ) }` );
				if ( url.endsWith( '/oauth2/token' ) ) {
					return json( { access_token: 'token' } );
				}
				if ( url.startsWith( 'https://mysite.com' ) ) {
					return new Response( '<title>Sonora</title>' );
				}
				if ( url.startsWith( 'https://archives.example.com' ) ) {
					return new Response( ZIP );
				}
				if ( method === 'POST' && ! rejected ) {
					rejected = true;
					return json( { code: 'oauth2_invalid_token', message: 'expired' }, 401 );
				}
				return json( method === 'POST' ? ready( { pages: 2 } ) : ready( { pages: 2 } ) );
			} )
		);
		const { result } = await run();

		expect( result ).toMatchObject( { counts: { pages: 2 } } );
		expect( calls.filter( ( call ) => call.endsWith( '/oauth2/token' ) ) ).toHaveLength( 2 );
	} );

	it( 'waits and starts again when another capture is being started', async () => {
		let busy = true;
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn( async ( url: string | URL, options: RequestInit = {} ) => {
				const method = options.method ?? 'GET';
				url = String( url );
				calls.push( `${ method } ${ url.replace( 'https://api.test', '' ) }` );
				if ( url.endsWith( '/oauth2/token' ) ) {
					return json( { access_token: 'token' } );
				}
				if ( url.startsWith( 'https://mysite.com' ) ) {
					return new Response( '<title>Sonora</title>' );
				}
				if ( url.startsWith( 'https://archives.example.com' ) ) {
					return new Response( ZIP );
				}
				if ( method === 'POST' && busy ) {
					busy = false;
					return json( { code: 'static_site_import_preview_busy', message: 'busy' }, 429 );
				}
				return json( ready( { pages: 1 } ) );
			} )
		);
		await expect( run() ).resolves.toMatchObject( { result: { counts: { pages: 1 } } } );
		expect(
			calls.filter( ( call ) => call === 'POST /wpcom/v2/static-site-import-preview' )
		).toHaveLength( 2 );
	} );

	/** Serve the token, then the given session states in order, then the archive. */
	function stubApi( states: Session[], refuse?: { code: string; status: number } ) {
		const calls: string[] = [];
		const queue = [ ...states ];
		vi.stubGlobal(
			'fetch',
			vi.fn( async ( url: string | URL, options: RequestInit = {} ) => {
				const method = options.method ?? 'GET';
				calls.push( `${ method } ${ String( url ).replace( 'https://api.test', '' ) }` );
				url = String( url );
				if ( url.endsWith( '/oauth2/token' ) ) {
					return json( { access_token: 'token', expires_in: 900 } );
				}
				if ( url.startsWith( 'https://archives.example.com' ) ) {
					return new Response( ZIP );
				}
				if ( url.startsWith( 'https://mysite.com' ) ) {
					return new Response( '<title>Sonora | Home</title>' );
				}
				if ( refuse ) {
					return json( { code: refuse.code, message: 'no' }, refuse.status );
				}
				if ( method === 'POST' ) {
					return json( session( 'capture_queued' ) );
				}
				if ( method === 'DELETE' ) {
					return json( session( 'failed' ) );
				}
				return json( queue.length > 1 ? queue.shift() : queue[ 0 ] );
			} )
		);
		return calls;
	}

	async function run() {
		const dir = fs.mkdtempSync( path.join( os.tmpdir(), 'liberate-pipeline-' ) );
		const config = {
			...loadConfig( { WPCOM_CLIENT_ID: '149292', WPCOM_CLIENT_SECRET: 'secret' } ),
			apiBase: 'https://api.test',
			pollMs: 1,
		};
		const progress: JobProgress[] = [];
		try {
			const result = await createPipeline( config, () => {} )(
				{ id: 'job', url: 'https://mysite.com/', host: 'mysite.com' } as JobRecord,
				{
					filesDir: dir,
					signal: new AbortController().signal,
					report: ( step ) => progress.push( step ),
				}
			);
			return { result, progress };
		} finally {
			fs.rmSync( dir, { recursive: true, force: true } );
		}
	}
} );
