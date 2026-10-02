import { loadConfig } from './config.ts';
import { UserError } from './guards.ts';
import {
	asUserError,
	fetchTitle,
	previewClient,
	progressFrom,
	siteNameFrom,
	viewFrom,
} from './wpcom.ts';
import type { JobRecord } from './store.ts';

const RECORD: JobRecord = {
	id: 'a'.repeat( 32 ),
	url: 'https://mysite.com/',
	host: 'mysite.com',
	siteName: 'Sonora',
	createdAt: 1_000,
	expiresAt: 2_000,
};

const json = ( body: unknown, status = 200 ) =>
	new Response( JSON.stringify( body ), {
		status,
		headers: { 'content-type': 'application/json' },
	} );

afterEach( () => vi.unstubAllGlobals() );

describe( 'progressFrom', () => {
	it( 'follows the capture, page by page', () => {
		const first = progressFrom( {
			session_id: 'x',
			state: 'capturing',
			progress: { pages_captured: 1, pages_total: 20 },
		} );
		expect( first ).toMatchObject( { step: 'capture', detail: 'Copied 1 of 20 pages' } );
		const last = progressFrom( {
			session_id: 'x',
			state: 'capturing',
			progress: { pages_captured: 20, pages_total: 20 },
		} );
		expect( last.progress ).toBeGreaterThan( first.progress );
	} );

	it( 'names the phase while there is nothing to count', () => {
		expect( progressFrom( { session_id: 'x', state: 'capture_queued' } ).step ).toBe( 'scan' );
		expect( progressFrom( { session_id: 'x', state: 'building' } ).step ).toBe( 'import' );
	} );

	it( 'treats a state it does not know as still on its way', () => {
		expect( progressFrom( { session_id: 'x', state: 'something_new' } ) ).toMatchObject( {
			step: 'scan',
			detail: 'Working…',
		} );
	} );
} );

describe( 'viewFrom', () => {
	it( 'reports a ready capture, with the importer’s verdict', () => {
		const view = viewFrom( RECORD, {
			session_id: RECORD.id,
			state: 'preview_ready',
			archive_url: 'https://archives.example.com/site.zip',
			preview_summary: { pages: 12, quality_pass: false },
		} );
		expect( view ).toMatchObject( {
			status: 'done',
			progress: 1,
			siteName: 'Sonora',
			counts: { pages: 12 },
			warning: expect.stringContaining( 'didn’t convert cleanly' ),
		} );
		expect( view.step ).toBeUndefined();
	} );

	it( 'says nothing about quality when the importer was happy', () => {
		const view = viewFrom( RECORD, {
			session_id: RECORD.id,
			state: 'preview_ready',
			preview_summary: { pages: 3, quality_pass: true, fidelity: { pass: true } },
		} );
		expect( view.warning ).toBeUndefined();
	} );

	it( 'turns a failed session into an answer for the visitor', () => {
		const view = viewFrom( RECORD, { session_id: RECORD.id, state: 'failed' } );
		expect( view ).toMatchObject( {
			status: 'failed',
			error: expect.stringMatching( /couldn’t copy/ ),
		} );
	} );

	it( 'carries this app’s own record, which the session does not have', () => {
		const view = viewFrom(
			{ ...RECORD, bytes: 2048 },
			{ session_id: RECORD.id, state: 'capturing' }
		);
		expect( view ).toMatchObject( {
			url: 'https://mysite.com/',
			host: 'mysite.com',
			siteName: 'Sonora',
			bytes: 2048,
			status: 'running',
		} );
	} );
} );

describe( 'previewClient', () => {
	const config = {
		...loadConfig( { WPCOM_CLIENT_ID: '149292', WPCOM_CLIENT_SECRET: 'secret' } ),
		apiBase: 'https://api.test',
	};

	/** Serve a token, then whatever the session calls should answer. */
	const stub = ( reply: ( method: string, url: string ) => Response ) => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn( async ( input: string | URL, init: RequestInit = {} ) => {
				const url = String( input );
				const method = init.method ?? 'GET';
				calls.push( `${ method } ${ url.replace( 'https://api.test', '' ) }` );
				return url.endsWith( '/oauth2/token' )
					? json( { access_token: 'token' } )
					: reply( method, url );
			} )
		);
		return calls;
	};

	it( 'mints one token and reuses it', async () => {
		const calls = stub( () => json( { session_id: 'a'.repeat( 32 ), state: 'capturing' } ) );
		const client = previewClient( config );
		await client.create( 'https://mysite.com/' );
		await client.status( 'a'.repeat( 32 ) );
		expect( calls.filter( ( call ) => call.endsWith( '/oauth2/token' ) ) ).toHaveLength( 1 );
	} );

	it( 'mints a fresh token and retries once when the old one is rejected', async () => {
		let rejected = false;
		const calls = stub( () => {
			if ( ! rejected ) {
				rejected = true;
				return json( { code: 'oauth2_invalid_token' }, 401 );
			}
			return json( { session_id: 'a'.repeat( 32 ), state: 'capturing' } );
		} );
		await expect( previewClient( config ).status( 'a'.repeat( 32 ) ) ).resolves.toMatchObject( {
			state: 'capturing',
		} );
		expect( calls.filter( ( call ) => call.endsWith( '/oauth2/token' ) ) ).toHaveLength( 2 );
	} );

	it( 'reads the archive size without downloading it', async () => {
		stub( () => new Response( null, { headers: { 'content-length': '1048576' } } ) );
		await expect(
			previewClient( config ).sizeOf( 'https://archives.test/site.zip' )
		).resolves.toBe( 1048576 );
	} );
} );

describe( 'asUserError', () => {
	it.each( [
		[ 'static_site_import_preview_daily_limit', 429, /capacity/ ],
		[ 'static_site_import_preview_busy', 429, /capacity/ ],
		[ 'invalid_static_site_source_url', 422, /public https/ ],
	] )( 'turns %s into something a visitor can read', async ( code, status, message ) => {
		vi.stubGlobal(
			'fetch',
			vi.fn( async () => json( { access_token: 'token' } ) )
		);
		const config = {
			...loadConfig( { WPCOM_CLIENT_ID: '1', WPCOM_CLIENT_SECRET: 's' } ),
			apiBase: 'https://api.test',
		};
		vi.stubGlobal(
			'fetch',
			vi.fn( async ( input: string ) =>
				String( input ).endsWith( '/oauth2/token' )
					? json( { access_token: 'token' } )
					: json( { code, message: 'no' }, status )
			)
		);
		const error = await previewClient( config )
			.create( 'https://mysite.com/' )
			.catch( ( thrown ) => asUserError( thrown ) );
		expect( error ).toBeInstanceOf( UserError );
		expect( ( error as UserError ).message ).toMatch( message );
	} );

	it( 'leaves anything else alone', () => {
		const error = new Error( 'socket hang up' );
		expect( asUserError( error ) ).toBe( error );
	} );
} );

describe( 'fetchTitle', () => {
	it( 'reads the title the source page gives itself', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn( async () => new Response( '<html><head><title>Tom &amp; Jerry</title></head>' ) )
		);
		expect( await fetchTitle( 'https://mysite.com/' ) ).toBe( 'Tom & Jerry' );
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
		expect( await fetchTitle( 'https://mysite.com/' ) ).toBe( 'Acme' );
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
		await expect( fetchTitle( 'https://mysite.com/' ) ).rejects.toThrow();
	} );
} );

describe( 'siteNameFrom', () => {
	it.each( [
		[ 'Sonora', 'Sonora' ],
		[ '  Dopple   Creative Studio ', 'Dopple Creative Studio' ],
		[ 'Home | Acme Coffee', 'Acme Coffee' ],
		[ 'Acme Coffee — Home', 'Acme Coffee' ],
		[ 'Imported Site', undefined ],
		[ 'Home', undefined ],
		[ '', undefined ],
		[ null, undefined ],
		[ 'The pooches of Sonora should get their own catwalk', undefined ],
	] )( 'turns %j into %j', ( title, name ) => {
		expect( siteNameFrom( title ) ).toBe( name );
	} );
} );
