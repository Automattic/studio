import fs from 'fs';
import http from 'http';
import { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { downloadFile } from '../download-file';
import { isNetworkError } from '../network-utils';

describe( 'downloadFile', () => {
	let releaseBody = () => {};
	let silentRequestReceived = () => {};
	const server = http.createServer( ( req, res ) => {
		if ( req.url === '/silent' ) {
			silentRequestReceived(); // and never responds
			return;
		}
		// Responds at once, then holds the body until the test releases it.
		res.writeHead( 200, { 'content-type': 'application/zip' } );
		res.write( 'part1-' );
		releaseBody = () => res.end( 'part2' );
	} );
	let baseUrl = '';
	const destination = path.join( os.tmpdir(), `download-file-test-${ process.pid }` );

	beforeAll( async () => {
		await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		baseUrl = `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }`;
	} );

	afterEach( () => {
		vi.useRealTimers();
		fs.rmSync( destination, { force: true } );
	} );

	afterAll( () => {
		server.closeAllConnections();
		server.close();
	} );

	it( 'fails as a network error when the server never starts responding', async () => {
		vi.useFakeTimers( { toFake: [ 'setTimeout', 'clearTimeout' ] } );
		const requested = new Promise< void >( ( resolve ) => ( silentRequestReceived = resolve ) );
		const download = downloadFile( `${ baseUrl }/silent`, destination ).catch( ( e ) => e );

		await requested;
		await vi.advanceTimersByTimeAsync( 5_000 );

		expect( isNetworkError( await download ) ).toBe( true );
	} );

	it( 'lets a slow body finish after the response has started', async () => {
		vi.useFakeTimers( { toFake: [ 'setTimeout', 'clearTimeout' ] } );
		const download = downloadFile( `${ baseUrl }/slow-body`, destination );

		await vi.waitFor( () => expect( fs.existsSync( destination ) ).toBe( true ), {
			interval: 5,
		} );
		await vi.advanceTimersByTimeAsync( 60_000 );
		releaseBody();
		await download;

		expect( fs.readFileSync( destination, 'utf8' ) ).toBe( 'part1-part2' );
	} );
} );
