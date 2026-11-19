import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	openStream,
	pairDevice,
	request,
	startRemoteTestServer,
	type TestRemoteServer,
} from './utils/remote-test-utils';

let test: TestRemoteServer;
let token: string;

beforeAll( async () => {
	test = await startRemoteTestServer( {
		cliBinary: path.join( import.meta.dirname, 'fixtures', 'fake-cli.mjs' ),
	} );
	( { token } = await pairDevice( test.server.port ) );
} );

afterAll( async () => {
	await test.stop();
} );

describe( 'sites sent to a paired device', () => {
	it( 'lists only the fields a phone needs', async () => {
		const reply = await request( test.server.port, { path: '/api/sites', token } );
		expect( reply.status ).toBe( 200 );
		expect( reply.text ).not.toContain( 'secret-admin-password' );
		expect( reply.text ).not.toContain( '/Users/someone' );
		expect( reply.json ).toEqual( [
			{ id: 's1', name: 'Fake site', running: true, url: 'http://localhost:8881' },
		] );
	} );

	it( 'streams site events without the admin password or paths', async () => {
		const stream = await openStream( test.server.port, token );
		try {
			const deadline = Date.now() + 2000;
			while ( ! stream.received().includes( 'site-event' ) && Date.now() < deadline ) {
				await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
			}
			const line = stream
				.received()
				.split( '\n' )
				.find( ( entry ) => entry.includes( 'site-event' ) );
			expect( line ).toBeDefined();
			expect( line ).not.toContain( 'secret-admin-password' );
			expect( line ).not.toContain( '/Users/someone' );
			const message = JSON.parse( line!.replace( /^data: /, '' ) );
			expect( message.payload ).toEqual( {
				event: 'site-updated',
				siteId: 's1',
				running: true,
				site: { id: 's1', name: 'Fake site', running: true, url: 'http://localhost:8881' },
			} );
		} finally {
			stream.destroy();
		}
	} );
} );
