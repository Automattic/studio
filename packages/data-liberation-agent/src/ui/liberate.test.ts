import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureWebsite } from '../lib/capture.js';
import { liberateSite } from './liberate.js';
import type { StaticServer } from '../lib/replicate/local-site/static-server.js';

vi.mock( '../lib/capture.js', () => ( { captureWebsite: vi.fn() } ) );

const root = join( process.cwd(), '.tmp-test' );

let server: StaticServer | null = null;
const dirs: string[] = [];

afterEach( async () => {
	if ( server ) await server.close();
	server = null;
	for ( const dir of dirs.splice( 0 ) ) rmSync( dir, { recursive: true, force: true } );
} );

function liberatedSite( outputDir: string ): void {
	const websiteDir = join( outputDir, 'website' );
	mkdirSync( websiteDir, { recursive: true } );
	writeFileSync(
		join( websiteDir, 'index.html' ),
		'<h1>Home</h1><a href="/about/">About</a><link rel="stylesheet" href="/site.css">'
	);
	writeFileSync( join( websiteDir, 'about.html' ), '<h1>About</h1>' );
	writeFileSync( join( websiteDir, 'site.css' ), 'body{color:red}' );
}

describe( 'liberateSite', () => {
	it( 'turns a URL into a runnable local site with working routes', async () => {
		mkdirSync( root, { recursive: true } );
		const outputBase = mkdtempSync( join( root, 'liberate-' ) );
		dirs.push( outputBase );
		vi.mocked( captureWebsite ).mockImplementationOnce( async ( options ) => {
			liberatedSite( options.outputDir );
			return {
				artifactPath: join( options.outputDir, 'artifact.json' ),
				captureReceiptPath: join( options.outputDir, 'capture-receipt.json' ),
				outputDir: options.outputDir,
				summary: {
					routesDiscovered: 2,
					routesCaptured: 2,
					routesSkipped: 0,
					routesFailed: 0,
					durationMs: 10,
				},
				failures: [],
				discoveryDiagnostics: [],
				provenance: { provider: 'data-liberation/browser-capture', platform: 'wix' },
			};
		} );

		const result = await liberateSite( { url: 'https://example.com/', outputBase } );
		server = result.server;

		expect( vi.mocked( captureWebsite ).mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			url: 'https://example.com/',
			outputDir: join( outputBase, 'example.com' ),
		} );
		expect( result.websiteDir ).toBe( join( outputBase, 'example.com', 'website' ) );
		expect( result.routesCaptured ).toBe( 2 );
		expect( result.routesSkipped ).toBe( 0 );
		expect( server ).not.toBeNull();

		const get = async ( path: string ) => {
			const response = await fetch( `${ server!.url }${ path }` );
			return { status: response.status, body: await response.text() };
		};
		expect( await get( '/' ) ).toMatchObject( { status: 200, body: expect.stringContaining( 'Home' ) } );
		expect( await get( '/about/' ) ).toMatchObject( {
			status: 200,
			body: expect.stringContaining( 'About' ),
		} );
		expect( await get( '/site.css' ) ).toMatchObject( {
			status: 200,
			body: expect.stringContaining( 'color:red' ),
		} );
	} );

	it( 'writes the site without serving when serving is disabled', async () => {
		mkdirSync( root, { recursive: true } );
		const outputBase = mkdtempSync( join( root, 'liberate-' ) );
		dirs.push( outputBase );
		vi.mocked( captureWebsite ).mockImplementationOnce( async ( options ) => {
			liberatedSite( options.outputDir );
			return {
				artifactPath: join( options.outputDir, 'artifact.json' ),
				captureReceiptPath: join( options.outputDir, 'capture-receipt.json' ),
				outputDir: options.outputDir,
				summary: {
					routesDiscovered: 1,
					routesCaptured: 1,
					routesSkipped: 0,
					routesFailed: 0,
					durationMs: 5,
				},
				failures: [],
				discoveryDiagnostics: [],
				provenance: { provider: 'data-liberation/browser-capture', platform: 'wix' },
			};
		} );

		const result = await liberateSite( {
			url: 'https://example.com/',
			outputBase,
			serve: false,
		} );

		expect( result.server ).toBeNull();
		expect( result.websiteDir ).toBe( join( outputBase, 'example.com', 'website' ) );
	} );
} );
