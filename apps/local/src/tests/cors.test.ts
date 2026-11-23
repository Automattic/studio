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
		allowedOrigins: [ 'https://app.test', 'null' ],
	} );
} );

afterAll( () => server.close() );

function healthFrom( origin: string ): Promise< http.IncomingMessage > {
	return new Promise( ( resolve, reject ) => {
		http
			.get(
				{
					host: '127.0.0.1',
					port: server.port,
					path: '/api/health',
					headers: { host: `localhost:${ server.port }`, origin },
				},
				( response ) => {
					response.resume();
					resolve( response );
				}
			)
			.on( 'error', reject );
	} );
}

it( 'lets a UI served elsewhere call with credentials, and nothing else', async () => {
	const app = await healthFrom( 'https://app.test' );
	expect( app.headers[ 'access-control-allow-origin' ] ).toBe( 'https://app.test' );
	expect( app.headers[ 'access-control-allow-credentials' ] ).toBe( 'true' );

	const local = await healthFrom( `http://localhost:${ server.port }` );
	expect( local.headers[ 'access-control-allow-credentials' ] ).toBeUndefined();

	expect( ( await healthFrom( 'null' ) ).statusCode ).toBe( 403 );
	expect( ( await healthFrom( 'https://evil.test' ) ).statusCode ).toBe( 403 );
} );
