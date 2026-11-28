import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	openStream,
	pairDevice,
	request,
	settlesWithin,
	startRemoteTestServer,
	type TestRemoteServer,
} from './utils/remote-test-utils';

let test: TestRemoteServer;

beforeAll( async () => {
	test = await startRemoteTestServer( {
		// Long, so only the close on `DELETE` can end the stream in time.
		remote: { label: 'Test Mac', studioVersion: '0.0.0-test', streamRecheckMs: 60_000 },
	} );
} );

afterAll( async () => {
	await test.stop();
} );

describe( 'a device that forgets the computer', () => {
	it( 'has its stream closed at once, not at the next recheck', async () => {
		const { token } = await pairDevice( test.server.port );
		const stream = await openStream( test.server.port, token );
		expect( stream.status ).toBe( 200 );
		try {
			const reply = await request( test.server.port, {
				method: 'DELETE',
				path: '/api/remote/devices/current',
				token,
			} );
			expect( reply.status ).toBe( 204 );
			expect( await settlesWithin( stream.ended, 1000 ) ).toBe( true );
		} finally {
			stream.destroy();
		}
	} );
} );
