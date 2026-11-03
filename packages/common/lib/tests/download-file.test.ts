import fs from 'fs';
import http from 'http';
import { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { downloadFile } from '../download-file';
import { isNetworkError } from '../network-utils';

describe( 'downloadFile', () => {
	let requested = () => {};
	const server = http.createServer( ( req, res ) => {
		requested();
		if ( req.url === '/missing' ) {
			res.writeHead( 404 ).end();
		} else if ( req.url === '/slow-body' ) {
			res.writeHead( 200 ).write( 'part1-' );
			setTimeout( () => res.end( 'part2' ), 6_000 );
		} // '/silent' never responds
	} );
	let base = '';
	const destination = path.join( os.tmpdir(), `download-file-test-${ process.pid }` );

	beforeAll( async () => {
		await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		base = `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }`;
	} );

	afterAll( () => {
		server.closeAllConnections();
		server.close();
		fs.rmSync( destination, { force: true } );
	} );

	const failure = ( url: string ) =>
		downloadFile( url, destination ).then(
			() => null,
			( e: unknown ) => e
		);

	it.each( [
		[ 'connection refused', () => 'http://127.0.0.1:1/file', true ],
		[ 'HTTP error', () => `${ base }/missing`, false ],
	] )( '%s → network error: %s', async ( _label, url, networkError ) => {
		expect( isNetworkError( await failure( url() ) ) ).toBe( networkError );
	} );

	it( 'fails as a network error when no response starts within 5 s', async () => {
		vi.useFakeTimers( { toFake: [ 'setTimeout', 'clearTimeout' ] } );
		const reached = new Promise< void >( ( resolve ) => ( requested = resolve ) );
		const download = failure( `${ base }/silent` );
		await reached;
		await vi.advanceTimersByTimeAsync( 5_000 );
		vi.useRealTimers();

		expect( isNetworkError( await download ) ).toBe( true );
	} );

	it( 'gives a body that has started all the time it needs', async () => {
		vi.useFakeTimers( { toFake: [ 'setTimeout', 'clearTimeout' ] } );
		const download = downloadFile( `${ base }/slow-body`, destination );
		await vi.waitFor( () => expect( fs.existsSync( destination ) ).toBe( true ) );
		await vi.advanceTimersByTimeAsync( 6_000 );
		vi.useRealTimers();
		await download;

		expect( fs.readFileSync( destination, 'utf8' ) ).toBe( 'part1-part2' );
	} );
} );
