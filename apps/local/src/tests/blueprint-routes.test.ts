import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';

const tmp = ( name: string ) => path.join( os.tmpdir(), `studio-test-${ name }` );
let server: LocalServer;

beforeAll( async () => {
	server = await startLocalServer( {
		cliBinary: tmp( 'cli.mjs' ),
		sessionsRoot: tmp( 'sessions' ),
		sitesRoot: tmp( 'sites' ),
		port: 0,
	} );
} );

afterAll( () => server.close() );

const post = ( route: string, body: unknown ) =>
	fetch( `${ server.url }/api${ route }`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( body ),
	} );

it( 'refuses to create a site from a remote Blueprint URL', async () => {
	const response = await post( '/sites', {
		name: 'A',
		path: tmp( 'sites/a' ),
		blueprint: 'http://169.254.169.254/latest',
	} );
	expect( response.status ).toBe( 400 );
} );

it( 'reads only Blueprints uploaded to the server', async () => {
	const response = await post( '/blueprints/read', { path: '/etc/passwd' } );
	expect( response.status ).toBe( 400 );
} );
