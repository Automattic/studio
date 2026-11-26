import fs from 'node:fs';
import { createServer, request } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import nock from 'nock';
import { ensureMachineTls } from 'cli/lib/serve-local-tls';

describe( 'machine TLS', () => {
	it( 'serves a site’s host with a certificate its own authority vouches for', async () => {
		nock.enableNetConnect( '127.0.0.1' );
		const directory = fs.mkdtempSync( path.join( os.tmpdir(), 'serve-tls-' ) );
		const tls = ensureMachineTls( directory, 'cloud.test' );
		const server = createServer( { cert: tls.cert, key: tls.key }, ( _req, res ) =>
			res.end( 'ok' )
		);
		await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		const address = server.address();
		const port = typeof address === 'object' && address ? address.port : 0;

		const body = await new Promise< string >( ( resolve, reject ) => {
			request(
				{
					host: '127.0.0.1',
					port,
					servername: 'site1--m1.cloud.test',
					headers: { host: 'site1--m1.cloud.test' },
					ca: fs.readFileSync( tls.caPath ),
				},
				( res ) => {
					let text = '';
					res.on( 'data', ( chunk ) => ( text += chunk ) );
					res.on( 'end', () => resolve( text ) );
				}
			)
				.on( 'error', reject )
				.end();
		} );
		server.close();

		expect( body ).toBe( 'ok' );
		expect( ensureMachineTls( directory, 'cloud.test' ).cert ).toBe( tls.cert );
	} );
} );
