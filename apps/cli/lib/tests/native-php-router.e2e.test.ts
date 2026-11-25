import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { resolveSupportedPhpVersion } from '@studio/common/lib/php-binary-metadata';
import nock from 'nock';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPhpBinaryPath } from 'cli/lib/dependency-management/paths';

const routerPath = path.resolve( import.meta.dirname, '../../php/router.php' );
const phpBinaryPath = getPhpBinaryPath( resolveSupportedPhpVersion( DEFAULT_PHP_VERSION ) );
const assetContents = 'asset bytes with a literal plus';

let root: string;
let fixtureDirectory: string;
let baseUrl: string;
let server: ChildProcess;

async function getAvailablePort(): Promise< number > {
	return await new Promise( ( resolve, reject ) => {
		const socket = net.createServer();
		socket.once( 'error', reject );
		socket.listen( 0, '127.0.0.1', () => {
			const address = socket.address();
			if ( ! address || typeof address === 'string' ) {
				socket.close();
				reject( new Error( 'Could not allocate a port for PHP' ) );
				return;
			}

			socket.close( () => resolve( address.port ) );
		} );
	} );
}

async function waitForServer( url: string ): Promise< void > {
	const deadline = Date.now() + 5000;
	while ( Date.now() < deadline ) {
		try {
			await fetch( url );
			return;
		} catch {
			await new Promise( ( resolve ) => setTimeout( resolve, 25 ) );
		}
	}

	throw new Error( 'PHP server did not start' );
}

async function request( requestPath: string ): Promise< { status: number; body: string } > {
	return await new Promise( ( resolve, reject ) => {
		http
			.get( `${ baseUrl }${ requestPath }`, ( response ) => {
				let body = '';
				response.setEncoding( 'utf8' );
				response.on( 'data', ( chunk ) => ( body += chunk ) );
				response.on( 'end', () => resolve( { status: response.statusCode ?? 0, body } ) );
			} )
			.on( 'error', reject );
	} );
}

describe( 'native PHP router', { tags: [ 'e2e' ] }, () => {
	beforeAll( async () => {
		nock.enableNetConnect( '127.0.0.1' );
		fixtureDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-php-router-' ) );
		root = path.join( fixtureDirectory, 'site' );
		fs.mkdirSync( root );
		fs.writeFileSync( path.join( root, 'logo+large.gif' ), assetContents );
		fs.writeFileSync( path.join( root, 'asset with spaces.gif' ), 'space asset bytes' );
		fs.writeFileSync( path.join( root, 'index.php' ), '<?php http_response_code( 404 );' );
		fs.writeFileSync( path.join( fixtureDirectory, 'secret.txt' ), 'must not be served' );

		for ( const file of [
			'wp-content/database/.ht.sqlite',
			'wp-content/database/backup.sqlite',
			'.well-known/security.txt',
			'../plugin/.git/config',
		] ) {
			fs.mkdirSync( path.dirname( path.join( root, file ) ), { recursive: true } );
			fs.writeFileSync( path.join( root, file ), file );
		}
		const uploads = path.join( root, 'wp-content/uploads/2024/05' );
		fs.mkdirSync( uploads, { recursive: true } );
		for ( const [ file, width, height ] of [
			[ path.join( uploads, 'photo.png' ), 40, 20 ],
			[ path.join( uploads, 'photo.jpg' ), 40, 20 ],
			[ path.join( uploads, 'large-scaled.png' ), 40, 20 ],
			[ path.join( root, 'wp-content/outside.png' ), 40, 20 ],
		] as const ) {
			execFileSync( phpBinaryPath, [
				'-r',
				`$image = imagecreatetruecolor( ${ width }, ${ height } ); image${
					file.endsWith( '.png' ) ? 'png' : 'jpeg'
				}( $image, ${ JSON.stringify( file ) } );`,
			] );
		}

		fs.mkdirSync( path.join( root, 'wp-content/plugins' ) );
		fs.symlinkSync(
			path.join( fixtureDirectory, 'plugin' ),
			path.join( root, 'wp-content/plugins/linked' ),
			'junction'
		);

		const port = await getAvailablePort();
		baseUrl = `http://127.0.0.1:${ port }`;
		server = spawn( phpBinaryPath, [ '-S', `127.0.0.1:${ port }`, routerPath ], {
			cwd: root,
			stdio: 'ignore',
			env: {
				...process.env,
				STUDIO_PHPMYADMIN_PATH: path.join( fixtureDirectory, 'phpmyadmin' ),
				STUDIO_PHPMYADMIN_SUPPORTED: '0',
			},
		} );
		await waitForServer( baseUrl );
	} );

	afterAll( () => {
		server.kill();
		fs.rmSync( fixtureDirectory, { recursive: true, force: true } );
	} );

	it.each( [
		'/phpmyadmin',
		'/phpmyadmin/',
		'/phpmyadmin/index.php',
		'/phpmyadmin/themes/dot.gif',
	] )( 'explains unsupported phpMyAdmin before loading SQLite: %s', async ( requestPath ) => {
		const response = await request( requestPath );
		expect( response.status ).toBe( 403 );
		expect( response.body ).toBe(
			'Studio’s phpMyAdmin supports SQLite only. Use a separate database client for external MySQL.'
		);
	} );

	it.each( [ '/logo+large.gif', '/logo%2Blarge.gif', '/logo%2Blarge.gif?cache=1' ] )(
		'serves literal and encoded plus signs without changing asset bytes: %s',
		async ( requestPath ) => {
			const response = await request( requestPath );

			expect( response ).toEqual( { status: 200, body: assetContents } );
		}
	);

	it( 'serves percent-encoded spaces', async () => {
		expect( await request( '/asset%20with%20spaces.gif' ) ).toEqual( {
			status: 200,
			body: 'space asset bytes',
		} );
	} );

	it( 'does not serve files outside the document root through an encoded traversal path', async () => {
		const response = await request( '/..%2Fsecret.txt' );

		expect( response.body ).not.toBe( 'must not be served' );
		expect( response.status ).not.toBe( 200 );
	} );

	it.each( [
		'/wp-content/database/.ht.sqlite',
		'/wp-content/database/backup.sqlite',
		'/WP-CONTENT/DATABASE/backup.sqlite',
		'/wp-content/plugins/linked/.git/config',
	] )( 'does not serve dotfiles or the database directory: %s', async ( requestPath ) => {
		expect( ( await request( requestPath ) ).status ).toBe( 404 );
	} );

	it( 'serves .well-known files', async () => {
		expect( await request( '/.well-known/security.txt' ) ).toEqual( {
			status: 200,
			body: '.well-known/security.txt',
		} );
	} );

	describe( 'missing image sizes', () => {
		const cache = () => path.join( root, 'wp-content/cache/studio-image-sizes/2024/05' );

		async function fetchImage( requestPath: string ) {
			const response = await fetch( `${ baseUrl }${ requestPath }` );
			const body = Buffer.from( await response.arrayBuffer() );
			return { status: response.status, type: response.headers.get( 'content-type' ), body };
		}

		it( 'makes a missing size from its original, in the cache rather than uploads', async () => {
			const response = await fetchImage( '/wp-content/uploads/2024/05/photo-10x10.png' );

			expect( response.status ).toBe( 200 );
			expect( response.type ).toBe( 'image/png' );
			// A PNG's width and height follow its signature and IHDR header.
			expect( [ response.body.readUInt32BE( 16 ), response.body.readUInt32BE( 20 ) ] ).toEqual( [
				10, 10,
			] );
			expect( fs.readFileSync( path.join( cache(), 'photo-10x10.png' ) ) ).toEqual( response.body );
			expect(
				fs.existsSync( path.join( root, 'wp-content/uploads/2024/05/photo-10x10.png' ) )
			).toBe( false );
		} );

		it( 'serves a size it made again from the cache', async () => {
			await fetchImage( '/wp-content/uploads/2024/05/photo-20x10.jpg' );
			const made = fs.statSync( path.join( cache(), 'photo-20x10.jpg' ) ).mtimeMs;

			const response = await fetchImage( '/wp-content/uploads/2024/05/photo-20x10.jpg' );

			expect( response ).toMatchObject( { status: 200, type: 'image/jpeg' } );
			expect( fs.statSync( path.join( cache(), 'photo-20x10.jpg' ) ).mtimeMs ).toBe( made );
		} );

		it( 'makes sizes of a large upload from its scaled copy', async () => {
			expect( await fetchImage( '/wp-content/uploads/2024/05/large-20x10.png' ) ).toMatchObject( {
				status: 200,
				type: 'image/png',
			} );
		} );

		it.each( [
			[ 'larger than the original', '/wp-content/uploads/2024/05/photo-80x40.png' ],
			[ 'without an original', '/wp-content/uploads/2024/05/missing-10x10.png' ],
			[ 'outside uploads', '/wp-content/uploads/..%2Foutside-10x10.png' ],
		] )( 'leaves a size %s to WordPress', async ( _, requestPath ) => {
			expect( ( await fetchImage( requestPath ) ).status ).toBe( 404 );
		} );
	} );
} );
