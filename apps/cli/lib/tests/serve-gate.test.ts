import { createServer, request, type Server } from 'node:http';
import { signToken } from '@studio/common/lib/signed-token';
import nock from 'nock';
import { vi } from 'vitest';
import { createServeGate } from 'cli/lib/serve-gate';

const sites = vi.hoisted( () => [] as { id: string; port: number; url: string }[] );
vi.mock( '@studio/common/lib/config/store', () => ( {
	readConfig: async () => ( { sites } ),
} ) );

const SECRET = 'machine-secret';
const API = 'https://m1.cloud.test';
const exp = () => Math.floor( Date.now() / 1000 ) + 3600;

let server: Server;
let site: Server;
let port: number;

beforeAll( async () => {
	nock.enableNetConnect( '127.0.0.1' );
	// A site that allows framing by localhost only and redirects permanently, as WordPress does.
	site = createServer( ( _req, res ) => {
		res.writeHead( 301, {
			Location: '/elsewhere/',
			'Content-Security-Policy': "frame-ancestors 'self' http://localhost:*",
		} );
		res.end();
	} );
	await new Promise< void >( ( resolve ) => site.listen( 0, '127.0.0.1', resolve ) );
	const siteAddress = site.address();
	sites.push( {
		id: 'site1',
		port: typeof siteAddress === 'object' && siteAddress ? siteAddress.port : 0,
		url: 'https://site1--m1.cloud.test',
	} );
	const options = {
		secret: SECRET,
		machineId: 'm1',
		apiOrigin: API,
		siteHostSuffix: '--m1.cloud.test',
		allowedOrigins: [ 'https://app.test' ],
	};
	// The tests talk to the gate over loopback, so it plays a visitor from outside unless told
	// the request comes from the machine itself.
	const fromOutside = createServeGate( { ...options, trustLoopback: false } );
	const fromMachine = createServeGate( options );
	server = createServer( ( req, res ) =>
		( req.headers[ 'x-test-from-machine' ] ? fromMachine : fromOutside )( req, res, () =>
			res.end( 'reached the API' )
		)
	);
	await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
	const address = server.address();
	port = typeof address === 'object' && address ? address.port : 0;
} );

afterAll( () => {
	server.close();
	site.close();
} );

function send(
	path: string,
	{ method = 'GET', headers = {} }: { method?: string; headers?: Record< string, string > } = {}
) {
	return new Promise< { status: number; headers: Record< string, unknown >; body: string } >(
		( resolve, reject ) => {
			const req = request(
				{
					host: '127.0.0.1',
					port,
					path,
					method,
					headers: { host: 'm1.cloud.test', ...headers },
				},
				( res ) => {
					let body = '';
					res.on( 'data', ( chunk ) => ( body += chunk ) );
					res.on( 'end', () =>
						resolve( { status: res.statusCode ?? 0, headers: res.headers, body } )
					);
				}
			);
			req.on( 'error', reject );
			req.end();
		}
	);
}

describe( 'serve gate', () => {
	it( 'refuses the API without a session for this machine', async () => {
		const otherMachine = await signToken( { purpose: 'session', aud: 'm2', exp: exp() }, SECRET );
		expect( ( await send( '/api/sites' ) ).status ).toBe( 401 );
		expect(
			( await send( '/api/sites', { headers: { authorization: `Bearer ${ otherMachine }` } } ) )
				.status
		).toBe( 401 );
		expect( ( await send( '/api/version' ) ).body ).toBe( 'reached the API' );
	} );

	it( 'lets a session in, and turns it into a cookie on login', async () => {
		const session = await signToken( { purpose: 'session', aud: 'm1', exp: exp() }, SECRET );
		const api = await send( '/api/sites', { headers: { authorization: `Bearer ${ session }` } } );
		expect( api.body ).toBe( 'reached the API' );

		const login = await send( '/api/cloud/login', {
			method: 'POST',
			headers: { authorization: `Bearer ${ session }` },
		} );
		const [ cookie ] = login.headers[ 'set-cookie' ] as string[];
		expect( cookie ).toContain( 'HttpOnly' );
		const withCookie = await send( '/api/sites', {
			headers: { cookie: cookie.split( ';' )[ 0 ] },
		} );
		expect( withCookie.body ).toBe( 'reached the API' );
	} );

	it( 'keeps sites private to whoever has access', async () => {
		const site = { host: 'site1--m1.cloud.test' };
		const page = await send( '/', { headers: { ...site, accept: 'text/html' } } );
		expect( page.status ).toBe( 302 );
		expect( page.headers.location ).toContain( `${ API }/api/cloud/site-access?return=` );
		expect( ( await send( '/wp-json/', { headers: site } ) ).status ).toBe( 401 );

		const handoff = await signToken(
			{ purpose: 'site-handoff', host: site.host, exp: exp() },
			SECRET
		);
		const access = await send( `/__studio/access?t=${ handoff }&return=/`, { headers: site } );
		const [ cookie ] = access.headers[ 'set-cookie' ] as string[];
		const visit = await send( '/', { headers: { ...site, cookie: cookie.split( ';' )[ 0 ] } } );
		expect( visit.status ).toBe( 301 );
	} );

	it( 'only sends a site access link back to the same site', async () => {
		const site = { host: 'site1--m1.cloud.test' };
		const handoff = await signToken(
			{ purpose: 'site-handoff', host: site.host, exp: exp() },
			SECRET
		);
		for ( const away of [ '//evil.test', '/\\evil.test', 'https://evil.test/' ] ) {
			const access = await send(
				`/__studio/access?t=${ handoff }&return=${ encodeURIComponent( away ) }`,
				{ headers: site }
			);
			expect( access.status ).toBe( 403 );
		}
		const access = await send( `/__studio/access?t=${ handoff }&return=%2Fwp-admin%2F`, {
			headers: site,
		} );
		expect( access.headers.location ).toBe( '/wp-admin/' );
	} );

	it( 'lets the machine itself reach its sites', async () => {
		const response = await send( '/', {
			headers: { host: 'site1--m1.cloud.test', 'x-test-from-machine': '1' },
		} );
		expect( response.status ).toBe( 301 );
	} );

	it( 'lets the UI frame a site and keeps browsers from caching its redirects', async () => {
		const response = await send( '/', {
			headers: { host: 'site1--m1.cloud.test', 'x-test-from-machine': '1' },
		} );
		expect( response.headers[ 'content-security-policy' ] ).toBe(
			"frame-ancestors 'self' http://localhost:* https://app.test"
		);
		expect( response.headers[ 'cache-control' ] ).toBe( 'no-store' );
	} );
} );
