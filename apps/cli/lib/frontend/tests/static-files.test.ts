import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	getContentType,
	getNotFoundPage,
	resolveStaticRequest,
} from 'cli/lib/frontend/static-files';

describe( 'resolveStaticRequest', () => {
	let tempDir: string;
	let root: string;

	beforeAll( () => {
		tempDir = fs.realpathSync( fs.mkdtempSync( path.join( os.tmpdir(), 'studio-static-' ) ) );
		root = path.join( tempDir, 'public' );
		fs.mkdirSync( path.join( root, 'blog' ), { recursive: true } );
		fs.mkdirSync( path.join( root, 'empty' ) );
		fs.writeFileSync( path.join( root, 'index.html' ), '<h1>Home</h1>' );
		fs.writeFileSync( path.join( root, 'about.html' ), '<h1>About</h1>' );
		fs.writeFileSync( path.join( root, 'blog', 'index.html' ), '<h1>Blog</h1>' );
		fs.writeFileSync( path.join( root, 'app.js' ), 'console.log(1)' );
		fs.writeFileSync( path.join( root, 'my file.css' ), 'body{}' );
		fs.writeFileSync( path.join( tempDir, 'secret.txt' ), 'secret' );
		if ( process.platform !== 'win32' ) {
			fs.symlinkSync( path.join( tempDir, 'secret.txt' ), path.join( root, 'escape.txt' ) );
		}
	} );

	afterAll( () => {
		fs.rmSync( tempDir, { recursive: true, force: true } );
	} );

	it( 'serves index.html for the root', () => {
		expect( resolveStaticRequest( root, '/' ) ).toEqual( {
			type: 'file',
			filePath: path.join( root, 'index.html' ),
		} );
	} );

	it( 'serves files, ignoring the query string', () => {
		expect( resolveStaticRequest( root, '/app.js?v=2' ) ).toEqual( {
			type: 'file',
			filePath: path.join( root, 'app.js' ),
		} );
	} );

	it( 'decodes percent-encoded names', () => {
		expect( resolveStaticRequest( root, '/my%20file.css' ) ).toEqual( {
			type: 'file',
			filePath: path.join( root, 'my file.css' ),
		} );
	} );

	it( 'serves index.html for a directory and redirects to its trailing slash', () => {
		expect( resolveStaticRequest( root, '/blog/' ) ).toEqual( {
			type: 'file',
			filePath: path.join( root, 'blog', 'index.html' ),
		} );
		expect( resolveStaticRequest( root, '/blog?page=2' ) ).toEqual( {
			type: 'redirect',
			location: '/blog/?page=2',
		} );
	} );

	it( 'serves <path>.html for clean URLs', () => {
		expect( resolveStaticRequest( root, '/about' ) ).toEqual( {
			type: 'file',
			filePath: path.join( root, 'about.html' ),
		} );
	} );

	it( 'returns not-found for missing files and directories without an index', () => {
		expect( resolveStaticRequest( root, '/missing.png' ) ).toEqual( { type: 'not-found' } );
		expect( resolveStaticRequest( root, '/empty/' ) ).toEqual( { type: 'not-found' } );
	} );

	it.each( [
		'/../secret.txt',
		'/%2e%2e/secret.txt',
		'/blog/%2e%2e/%2e%2e/secret.txt',
		'/..%2fsecret.txt',
		'/..%5csecret.txt',
		'/%00',
		'/%E0%A4%A',
	] )( 'never resolves outside the served folder: %s', ( url ) => {
		const resolution = resolveStaticRequest( root, url );
		if ( resolution.type === 'file' ) {
			expect( resolution.filePath.startsWith( root + path.sep ) ).toBe( true );
		}
		expect( resolution ).not.toEqual( {
			type: 'file',
			filePath: path.join( tempDir, 'secret.txt' ),
		} );
	} );

	it.skipIf( process.platform === 'win32' )( 'refuses symlinks that point outside', () => {
		expect( resolveStaticRequest( root, '/escape.txt' ) ).toEqual( { type: 'not-found' } );
	} );

	it( 'finds a 404 page when there is one', () => {
		expect( getNotFoundPage( root ) ).toBeUndefined();
		fs.writeFileSync( path.join( root, '404.html' ), 'nope' );
		expect( getNotFoundPage( root ) ).toBe( path.join( root, '404.html' ) );
	} );
} );

describe( 'getContentType', () => {
	it( 'maps common web types', () => {
		expect( getContentType( 'index.html' ) ).toBe( 'text/html; charset=utf-8' );
		expect( getContentType( 'APP.JS' ) ).toBe( 'text/javascript; charset=utf-8' );
		expect( getContentType( 'logo.svg' ) ).toBe( 'image/svg+xml' );
		expect( getContentType( 'font.woff2' ) ).toBe( 'font/woff2' );
		expect( getContentType( 'blob.bin' ) ).toBe( 'application/octet-stream' );
	} );
} );
