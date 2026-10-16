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
