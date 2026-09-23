import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';

let server: LocalServer;
let configDir: string;
let sessionsRoot: string;
let siteRoot: string;
let outsideDir: string;

beforeEach( async () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-media-config-' ) );
	sessionsRoot = mkdtempSync( path.join( os.tmpdir(), 'studio-media-sessions-' ) );
	siteRoot = mkdtempSync( path.join( os.tmpdir(), 'studio-media-site-' ) );
	outsideDir = mkdtempSync( path.join( os.tmpdir(), 'studio-media-outside-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
	writeFileSync(
		path.join( configDir, 'cli.json' ),
		JSON.stringify( { sites: [ { id: 'site', path: siteRoot } ] } )
	);
	server = await startLocalServer( {
		cliBinary: path.join( os.tmpdir(), 'studio-test-cli.mjs' ),
		sessionsRoot,
		sitesRoot: path.join( os.tmpdir(), 'studio-test-sites' ),
		port: 0,
	} );
} );

afterEach( async () => {
	await server.close();
	delete process.env.DEV_CONFIG_DIR;
	for ( const dir of [ configDir, sessionsRoot, siteRoot, outsideDir ] ) {
		rmSync( dir, { recursive: true, force: true } );
	}
} );

const read = ( filePath: string ) =>
	fetch( `${ server.url }/api/media/read?path=${ encodeURIComponent( filePath ) }` );

describe( 'GET /api/media/read', () => {
	it( 'serves a screenshot sidecar image under the sessions root', async () => {
		const sidecar = path.join( sessionsRoot, '2026', '09', 'session.screenshots' );
		mkdirSync( sidecar, { recursive: true } );
		const image = path.join( sidecar, 'screenshot-preview-1-abcdef01.png' );
		writeFileSync( image, Buffer.from( [ 0x89, 0x50, 0x4e, 0x47 ] ) );

		const response = await read( image );

		expect( response.status ).toBe( 200 );
		expect( response.headers.get( 'content-type' ) ).toBe( 'image/png' );
		expect( Buffer.from( await response.arrayBuffer() ) ).toEqual(
			Buffer.from( [ 0x89, 0x50, 0x4e, 0x47 ] )
		);
	} );

	it( 'serves a generated image inside a registered site', async () => {
		const uploads = path.join( siteRoot, 'wp-content', 'uploads', '2026', '09' );
		mkdirSync( uploads, { recursive: true } );
		const image = path.join( uploads, 'hero.jpg' );
		writeFileSync( image, Buffer.from( [ 0xff, 0xd8, 0xff ] ) );

		const response = await read( image );

		expect( response.status ).toBe( 200 );
		expect( response.headers.get( 'content-type' ) ).toBe( 'image/jpeg' );
		expect( Buffer.from( await response.arrayBuffer() ) ).toEqual(
			Buffer.from( [ 0xff, 0xd8, 0xff ] )
		);
	} );

	it( 'refuses anything but raster images under the sessions root or a site, symlinks resolved', async () => {
		const secret = path.join( outsideDir, 'secret.png' );
		writeFileSync( secret, 'nope' );
		const sessionLink = path.join( sessionsRoot, 'link.png' );
		symlinkSync( secret, sessionLink );
		const siteLink = path.join( siteRoot, 'wp-content', 'uploads', 'link.png' );
		mkdirSync( path.dirname( siteLink ), { recursive: true } );
		symlinkSync( secret, siteLink );

		expect( ( await read( path.join( siteRoot, 'wp-config.php' ) ) ).status ).toBe( 400 );
		for ( const requested of [
			secret,
			sessionLink,
			siteLink,
			[ sessionsRoot, '..', path.basename( outsideDir ), 'secret.png' ].join( path.sep ),
			[ siteRoot, '..', path.basename( outsideDir ), 'secret.png' ].join( path.sep ),
		] ) {
			expect( ( await read( requested ) ).status, requested ).toBe( 404 );
		}
	} );
} );
