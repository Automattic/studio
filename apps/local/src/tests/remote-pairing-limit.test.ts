import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request, startRemoteTestServer, type TestRemoteServer } from './utils/remote-test-utils';

let test: TestRemoteServer;

beforeAll( async () => {
	test = await startRemoteTestServer();
} );

afterAll( async () => {
	await test.stop();
} );

describe( 'the pairing route', () => {
	it( 'answers 429 to the 11th request within a minute', async () => {
		const statuses: number[] = [];
		for ( let attempt = 0; attempt < 11; attempt++ ) {
			// An empty body is refused before the store is touched.
			const reply = await request( test.server.port, {
				method: 'POST',
				path: '/api/remote/pair',
				body: {},
			} );
			statuses.push( reply.status );
		}
		expect( statuses.slice( 0, 10 ) ).toEqual( Array( 10 ).fill( 400 ) );
		expect( statuses[ 10 ] ).toBe( 429 );
	} );
} );
