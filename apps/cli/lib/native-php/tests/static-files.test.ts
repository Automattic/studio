import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { serveStaticFile } from 'cli/lib/native-php/static-files';
import type { AddressInfo } from 'net';

describe( 'serveStaticFile', () => {
	let sitePath: string;
	let server: http.Server;
	let baseUrl: string;

	beforeAll( async () => {
		sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-static-files-' ) );
		const write = ( relativePath: string, content: string ) => {
			fs.mkdirSync( path.dirname( path.join( sitePath, relativePath ) ), { recursive: true } );
			fs.writeFileSync( path.join( sitePath, relativePath ), content );
		};
		write( 'wp-includes/js/app.js', 'console.log(1);' );
		write( 'index.php', '<?php' );
		write( '.env', 'SECRET=1' );
		write( 'wp-content/database/.ht.sqlite', 'db' );

		// Requests the helper leaves alone answer 418, standing in for the PHP workers.
		server = http.createServer( ( req, res ) => {
			if ( ! serveStaticFile( sitePath, req, res ) ) {
				res.writeHead( 418 );
				res.end();
			}
		} );
		await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		baseUrl = `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }`;
	} );

	afterAll( async () => {
		await new Promise( ( resolve ) => server.close( resolve ) );
		fs.rmSync( sitePath, { recursive: true, force: true } );
	} );

	it( 'serves a static file with validators and answers a revalidation with 304', async () => {
		const response = await fetch( `${ baseUrl }/wp-includes/js/app.js?ver=1` );
		expect( response.status ).toBe( 200 );
		expect( await response.text() ).toBe( 'console.log(1);' );
		expect( response.headers.get( 'content-type' ) ).toBe( 'text/javascript; charset=utf-8' );
		expect( response.headers.get( 'cache-control' ) ).toBe( 'no-cache' );

		const etag = response.headers.get( 'etag' )!;
		const revalidated = await fetch( `${ baseUrl }/wp-includes/js/app.js?ver=1`, {
			headers: { 'If-None-Match': etag },
		} );
		expect( revalidated.status ).toBe( 304 );
		expect( await revalidated.text() ).toBe( '' );
	} );

	it.each( [
		'/index.php',
		'/missing.js',
		'/wp-includes/js/',
		'/.env',
		'/wp-content/database/.ht.sqlite',
		'/WP-CONTENT/Database/.ht.sqlite',
		'/%2e%2e/etc/passwd',
	] )( 'leaves %s to PHP', async ( requestPath ) => {
		const response = await fetch( `${ baseUrl }${ requestPath }` );
		expect( response.status ).toBe( 418 );
	} );
} );
