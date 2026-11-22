import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { StaticFiles } from 'cli/lib/native-php/static-files';
import type { AddressInfo } from 'net';

describe( 'StaticFiles', () => {
	let sitePath: string;
	let server: http.Server;
	let baseUrl: string;
	let phpRequests: string[];

	beforeAll( async () => {
		sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-static-files-' ) );
		fs.mkdirSync( path.join( sitePath, 'wp-includes' ) );
		fs.writeFileSync( path.join( sitePath, 'wp-includes', 'app.js' ), 'console.log(1);' );
		fs.writeFileSync( path.join( sitePath, '.env' ), 'SECRET=1' );

		// Stands in for the proxy in front of PHP's built-in server, which serves existing files
		// and answers 404 for private ones such as dotfiles.
		const staticFiles = new StaticFiles( sitePath );
		server = http.createServer( ( req, res ) => {
			if ( staticFiles.answer( req, res ) ) {
				return;
			}
			phpRequests.push( req.url! );
			const isPrivate = req.url!.startsWith( '/.' );
			const headers: http.IncomingHttpHeaders = { 'content-type': 'text/javascript' };
			staticFiles.addValidators( req, isPrivate ? 404 : 200, headers );
			res.writeHead( isPrivate ? 404 : 200, headers as http.OutgoingHttpHeaders );
			// The only public file the tests request.
			res.end( isPrivate ? '' : fs.readFileSync( path.join( sitePath, 'wp-includes', 'app.js' ) ) );
		} );
		await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		baseUrl = `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }`;
	} );

	beforeEach( () => {
		phpRequests = [];
	} );

	afterAll( async () => {
		await new Promise( ( resolve ) => server.close( resolve ) );
		fs.rmSync( sitePath, { recursive: true, force: true } );
	} );

	it( 'serves a file PHP has served, with its content type, and revalidates it without PHP', async () => {
		const url = `${ baseUrl }/wp-includes/app.js?ver=1`;
		const first = await fetch( url );
		const etag = first.headers.get( 'etag' )!;
		expect( etag ).toMatch( /^W\/"/ );
		expect( first.headers.get( 'cache-control' ) ).toBe( 'no-cache' );

		const again = await fetch( url );
		expect( again.status ).toBe( 200 );
		expect( again.headers.get( 'content-type' ) ).toBe( 'text/javascript' );
		expect( await again.text() ).toBe( 'console.log(1);' );

		const unchanged = await fetch( url, { headers: { 'If-None-Match': etag } } );
		expect( unchanged.status ).toBe( 304 );

		const file = path.join( sitePath, 'wp-includes', 'app.js' );
		fs.writeFileSync( file, 'console.log(2);' );
		fs.utimesSync( file, new Date(), new Date( Date.now() + 5000 ) );
		const changed = await fetch( url, { headers: { 'If-None-Match': etag } } );
		expect( changed.status ).toBe( 200 );
		expect( await changed.text() ).toBe( 'console.log(2);' );

		expect( phpRequests ).toEqual( [ '/wp-includes/app.js?ver=1' ] );
	} );

	it( 'leaves a path PHP keeps private to PHP, even with a matching validator', async () => {
		const stats = fs.statSync( path.join( sitePath, '.env' ) );
		const etag = `W/"${ stats.size.toString( 16 ) }-${ Math.floor( stats.mtimeMs ).toString(
			16
		) }"`;

		const response = await fetch( `${ baseUrl }/.env`, { headers: { 'If-None-Match': etag } } );
		expect( response.status ).toBe( 404 );
		expect( response.headers.get( 'etag' ) ).toBeNull();
		await fetch( `${ baseUrl }/.env` );
		expect( phpRequests ).toEqual( [ '/.env', '/.env' ] );
	} );
} );
