import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.ts';
import { UserError } from './guards.ts';
import {
	createPipeline,
	describeSource,
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

describe( 'describeSource', () => {
	it( 'reads the name and platform the capture recorded', () => {
		expect(
			describeSource( { capture: { title: 'Sonora', source: { platform: 'squarespace' } } } )
		).toEqual( { title: 'Sonora', platform: 'Squarespace' } );
	} );

	it( 'says nothing when the summary does not carry them', () => {
		expect( describeSource( {} ) ).toEqual( { title: undefined, platform: undefined } );
		expect( describeSource( undefined ) ).toEqual( { title: undefined, platform: undefined } );
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
			ready( { capture: { title: 'Sonora | Home', source: { platform: 'squarespace' } } } ),
		] );
		const { result, progress } = await run();

		expect( result ).toMatchObject( {
			siteName: 'Sonora',
			platform: 'Squarespace',
			counts: { pages: 4 },
			files: { site: ZIP.length },
		} );
		expect( progress.map( ( step ) => step.step ) ).toEqual( [
			'scan',
			'capture',
			'package',
			'package',
		] );
		expect( calls ).toEqual( [
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

	/** Serve the token, then the given session states in order, then the archive. */
	function stubApi( states: Session[], refuse?: { code: string; status: number } ) {
		const calls: string[] = [];
		const queue = [ ...states ];
		vi.stubGlobal(
			'fetch',
			vi.fn( async ( url: string, options: RequestInit = {} ) => {
				const method = options.method ?? 'GET';
				calls.push( `${ method } ${ url.replace( 'https://api.test', '' ) }` );
				if ( url.endsWith( '/oauth2/token' ) ) {
					return json( { access_token: 'token', expires_in: 900 } );
				}
				if ( url.startsWith( 'https://archives.example.com' ) ) {
					return new Response( ZIP );
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
