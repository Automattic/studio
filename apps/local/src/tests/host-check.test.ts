import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';

let server: LocalServer;

beforeAll( async () => {
	server = await startLocalServer( {
		cliBinary: path.join( os.tmpdir(), 'studio-test-cli.mjs' ),
		sessionsRoot: path.join( os.tmpdir(), 'studio-test-sessions' ),
		sitesRoot: path.join( os.tmpdir(), 'studio-test-sites' ),
		port: 0,
		allowedOrigins: [ 'https://studio-8081.app.github.dev' ],
	} );
} );

afterAll( () => server.close() );

function statusFor( hostHeader: string ): Promise< number | undefined > {
	return new Promise( ( resolve, reject ) => {
		http
			.get(
				{
					host: '127.0.0.1',
					port: server.port,
					path: '/api/health',
					headers: { host: hostHeader },
				},
				( response ) => {
					response.resume();
					resolve( response.statusCode );
				}
			)
			.on( 'error', reject );
	} );
}

it( 'only answers requests addressed to a local name', async () => {
	expect( await statusFor( `localhost:${ server.port }` ) ).toBe( 200 );
	expect( await statusFor( `rebound.example:${ server.port }` ) ).toBe( 403 );
} );

it( 'answers requests addressed to an allowed origin', async () => {
	expect( await statusFor( 'studio-8081.app.github.dev' ) ).toBe( 200 );
} );

it( 'offers the redirect login only for a local callback', async () => {
	const loginUrl = async ( redirectUri: string ) => {
		const response = await fetch(
			`http://127.0.0.1:${ server.port }/api/auth/login-url?redirect_uri=${ encodeURIComponent(
				redirectUri
			) }`
		);
		return ( ( await response.json() ) as { url: string | null } ).url;
	};
	expect( await loginUrl( `http://localhost:${ server.port }/auth/callback` ) ).toContain(
		'wordpress.com'
	);
	expect( await loginUrl( 'https://studio-8081.app.github.dev/auth/callback' ) ).toBeNull();
} );
