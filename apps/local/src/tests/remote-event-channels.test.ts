import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	openStream,
	pairDevice,
	startRemoteTestServer,
	type TestRemoteServer,
} from './utils/remote-test-utils';

let test: TestRemoteServer;

beforeAll( async () => {
	test = await startRemoteTestServer( {
		// Reports a site event and an auth event every 80 ms.
		cliBinary: path.join( import.meta.dirname, 'fixtures', 'fake-cli.mjs' ),
	} );
} );

afterAll( async () => {
	await test.stop();
} );

describe( 'the event stream of a paired device', () => {
	it( 'carries site events and no sign-in events', async () => {
		const { token } = await pairDevice( test.server.port );
		const stream = await openStream( test.server.port, token );
		try {
			const deadline = Date.now() + 2000;
			while ( ! stream.received().includes( '"site-event"' ) && Date.now() < deadline ) {
				await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
			}
			// The auth event is sent just before each site event, so one tick is enough.
			await new Promise( ( resolve ) => setTimeout( resolve, 250 ) );
			expect( stream.received() ).toContain( '"channel":"site-event"' );
			expect( stream.received() ).not.toContain( 'auth-event' );
			expect( stream.received() ).not.toContain( 'auth-login' );
		} finally {
			stream.destroy();
		}
	} );
} );
