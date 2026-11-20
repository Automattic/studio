import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';
import { isRemoteRouteAllowed } from '../remote-mode';
import {
	baseServerOptions,
	pairDevice,
	request as send,
	startRemoteTestServer,
	type RequestOptions,
	type TestRemoteServer,
} from './utils/remote-test-utils';

let test: TestRemoteServer;
let server: LocalServer;
// Pairing allows 10 requests a minute, so the file pairs once and reuses this.
let token: string;

beforeAll( async () => {
	test = await startRemoteTestServer();
	server = test.server;
	( { token } = await pairDevice( server.port ) );
} );

afterAll( async () => {
	await test.stop();
} );

function request( options: RequestOptions ) {
	return send( server.port, options );
}

describe( 'remote mode', () => {
	// A regression here would leave an unauthenticated listener open, so a server
	// that starts anyway is closed before the assertion fails.
	async function expectRefusal( host: string ) {
		let started: LocalServer | undefined;
		let error: unknown;
		try {
			started = await startLocalServer( { ...baseServerOptions, host } );
		} catch ( caught ) {
			error = caught;
		}
		await started?.close();
		expect( started?.url ).toBeUndefined();
		expect( String( error ) ).toMatch( /remote mode/i );
	}

	it( 'refuses to listen on the network without remote mode', async () => {
		await expectRefusal( '0.0.0.0' );
	} );

	it( 'refuses a host name that only looks like loopback', async () => {
		await expectRefusal( '127.example.com' );
	} );

	it( 'reports the bound host in its address', () => {
		expect( server.url ).toBe( `http://127.0.0.1:${ server.port }` );
		expect( server.url ).not.toContain( 'localhost' );
	} );

	it( 'brackets an IPv6 host in its address', async ( context ) => {
		let ipv6: LocalServer;
		try {
			ipv6 = await startLocalServer( {
				...baseServerOptions,
				host: '::1',
				remote: { label: 'Test Mac', studioVersion: '0.0.0-test' },
			} );
		} catch {
			// No IPv6 loopback on this machine.
			context.skip();
			return;
		}
		try {
			expect( ipv6.url ).toBe( `http://[::1]:${ ipv6.port }` );
		} finally {
			await ipv6.close();
		}
	} );

	it( 'describes itself without auth', async () => {
		const reply = await request( { path: '/.well-known/studio/remote' } );
		expect( reply.status ).toBe( 200 );
		expect( reply.json ).toMatchObject( {
			label: 'Test Mac',
			protocolVersion: 1,
			studioVersion: '0.0.0-test',
		} );
		expect( reply.json?.instanceId ).toMatch( /^[0-9a-f-]{36}$/ );
	} );

	it( 'rejects a wrong pairing code', async () => {
		const reply = await request( {
			method: 'POST',
			path: '/api/remote/pair',
			body: { code: 'WRONGWRONGWR', deviceName: 'Test phone', platform: 'ios' },
		} );
		expect( reply.status ).toBe( 401 );
	} );

	it( 'refuses a large body before the guard reads it', async () => {
		const reply = await request( {
			method: 'POST',
			path: '/api/remote/pair',
			body: {
				code: 'WRONGWRONGWR',
				deviceName: 'Test phone',
				platform: 'ios',
				padding: 'x'.repeat( 300_000 ),
			},
		} );
		expect( reply.status ).toBe( 413 );
	} );

	it( 'still answers a modest body with a wrong code', async () => {
		const reply = await request( {
			method: 'POST',
			path: '/api/remote/pair',
			body: {
				code: 'WRONGWRONGWR',
				deviceName: 'Test phone',
				platform: 'ios',
				padding: 'x'.repeat( 100_000 ),
			},
		} );
		expect( reply.status ).toBe( 401 );
	} );

	it( 'rejects a pairing request with missing fields', async () => {
		const reply = await request( {
			method: 'POST',
			path: '/api/remote/pair',
			body: { code: 'ABCDEFGH2345' },
		} );
		expect( reply.status ).toBe( 400 );
	} );

	it( 'pairs a device and lets its token in', async () => {
		expect( ( await request( { path: '/api/health', token } ) ).status ).toBe( 200 );
		expect( ( await request( { path: '/api/runs/active', token } ) ).status ).toBe( 200 );
	} );

	it( 'answers 401 without a valid token', async () => {
		expect( ( await request( { path: '/api/health' } ) ).status ).toBe( 401 );
		expect( ( await request( { path: '/api/health', token: 'nope' } ) ).status ).toBe( 401 );
	} );

	it( 'matches the Bearer scheme in any case', async () => {
		for ( const scheme of [ 'bearer', 'BEARER', 'Bearer' ] ) {
			const reply = await request( {
				path: '/api/health',
				headers: { authorization: `${ scheme } ${ token }` },
			} );
			expect( `${ scheme } ${ reply.status }` ).toBe( `${ scheme } 200` );
		}
	} );

	it( 'does not take another scheme or a bare token', async () => {
		for ( const authorization of [ `Basic ${ token }`, token ] ) {
			const reply = await request( { path: '/api/health', headers: { authorization } } );
			expect( reply.status ).toBe( 401 );
		}
	} );

	// Written out by hand, so widening the allowlist cannot also widen this table.
	it.each( [
		[ 'DELETE', '/api/remote/devices/current' ],
		[ 'GET', '/api/health' ],
		[ 'GET', '/api/sites' ],
		[ 'GET', '/api/sessions' ],
		[ 'POST', '/api/sessions' ],
		[ 'GET', '/api/sessions/abc' ],
		[ 'POST', '/api/sessions/abc/messages' ],
		[ 'GET', '/api/runs/active' ],
		[ 'POST', '/api/runs/run-1/interrupt' ],
		[ 'POST', '/api/runs/run-1/answer' ],
		[ 'GET', '/api/events' ],
	] )( 'answers 401 to %s %s without a valid token', async ( method, path ) => {
		const body = method === 'POST' ? { prompt: 'hello' } : undefined;
		expect( ( await request( { method, path, body } ) ).status ).toBe( 401 );
		expect( ( await request( { method, path, body, token: 'A'.repeat( 43 ) } ) ).status ).toBe(
			401
		);
	} );

	it( 'registers exactly the allowed routes it lets a phone reach', () => {
		const allowed = server.apiRoutes
			.filter( ( route ) =>
				isRemoteRouteAllowed( route.method, route.path.replace( /:[A-Za-z]+/g, 'x' ) )
			)
			.map( ( route ) => `${ route.method } ${ route.path }` );
		expect( allowed.sort() ).toEqual(
			[
				'POST /remote/pair',
				'DELETE /remote/devices/current',
				'GET /health',
				'GET /sites',
				'POST /sites/:id/screenshot',
				'GET /sites/:id/thumbnail',
				'GET /sessions',
				'POST /sessions',
				'GET /sessions/:id',
				'POST /sessions/:id/messages',
				'GET /runs/active',
				'POST /runs/:runId/interrupt',
				'POST /runs/:runId/answer',
				'GET /events',
			].sort()
		);
	} );

	it( 'rejects an Origin that studio ui allows', async () => {
		const origin = 'http://localhost:5400';
		expect( ( await request( { path: '/api/health', token, origin } ) ).status ).toBe( 403 );
		expect( ( await request( { path: '/.well-known/studio/remote', origin } ) ).status ).toBe(
			403
		);
	} );

	it( 'answers a request addressed to a non-local host name', async () => {
		const reply = await request( {
			path: '/api/health',
			token,
			headers: { host: 'phone.example:1234' },
		} );
		expect( reply.status ).toBe( 200 );
	} );

	it( 'answers 403 for every registered route outside the allowlist', async () => {
		const blocked = server.apiRoutes
			.map( ( route ) => ( { ...route, path: route.path.replace( /:[A-Za-z]+/g, 'x' ) } ) )
			.filter( ( route ) => ! isRemoteRouteAllowed( route.method, route.path ) );
		expect( blocked.length ).toBeGreaterThan( 50 );
		for ( const route of blocked ) {
			const reply = await request( { method: route.method, path: `/api${ route.path }`, token } );
			expect( `${ route.method } ${ route.path } ${ reply.status }` ).toBe(
				`${ route.method } ${ route.path } 403`
			);
		}
	} );

	it( 'answers 403 for a path the server does not know', async () => {
		expect( ( await request( { path: '/api/no-such-route', token } ) ).status ).toBe( 403 );
	} );

	it( 'rejects requests that come from a web page', async () => {
		const reply = await request( { path: '/api/health', token, origin: 'http://evil.example' } );
		expect( reply.status ).toBe( 403 );
	} );

	it( 'accepts text messages only', async () => {
		const reply = await request( {
			method: 'POST',
			path: '/api/sessions/some-session/messages',
			token,
			body: { prompt: 'hello', images: [ { mimeType: 'image/png', data: 'AAAA' } ] },
		} );
		expect( reply.status ).toBe( 400 );
		expect( reply.json?.error ).toMatch( /attachments/i );
	} );

	it( 'lets a phone forget this computer', async () => {
		const own = await pairDevice( server.port );
		const reply = await request( {
			method: 'DELETE',
			path: '/api/remote/devices/current',
			token: own.token,
		} );
		expect( reply.status ).toBe( 204 );
		expect( ( await request( { path: '/api/health', token: own.token } ) ).status ).toBe( 401 );
	} );

	it( 'does not serve the sign-in callback page', async () => {
		expect( ( await request( { path: '/auth/callback' } ) ).status ).toBe( 404 );
	} );
} );
