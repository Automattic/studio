import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareLiberatedCapture, liberateWebsite } from '../data-liberation-client';
import type { CaptureEngine } from '../import-runtime';

// An injected engine skips the browser check; this proves no test here can reach it.
vi.mock( 'cli/ai/browser-utils', () => ( {
	ensurePlaywrightChromiumInstalled: vi.fn( () => {
		throw new Error( 'the browser check must not run with an injected engine' );
	} ),
} ) );

const roots: string[] = [];

function tempRoot(): string {
	const root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-liberation-' ) );
	roots.push( root );
	return root;
}

function engine( overrides: Partial< CaptureEngine > = {} ): CaptureEngine {
	return {
		version: '9.9.9',
		packageUrl: 'https://example.com/data-liberation-9.9.9.tgz',
		captureWebsite: vi.fn( async ( { outputDir } ) => {
			fs.mkdirSync( path.join( outputDir, 'website' ), { recursive: true } );
			return {
				captureReceiptPath: path.join( outputDir, 'capture-receipt.json' ),
				outputDir,
				summary: { routesDiscovered: 3, routesCaptured: 3, routesSkipped: 0, routesFailed: 0 },
			};
		} ),
		checkFidelity: vi.fn(),
		...overrides,
	};
}

afterEach( () => {
	for ( const root of roots.splice( 0 ) ) {
		fs.rmSync( root, { recursive: true, force: true } );
	}
} );

describe( 'liberateWebsite', () => {
	it( 'captures with the release engine and returns the website directory', async () => {
		const outputBase = tempRoot();
		const loaded = engine();
		const progress: string[] = [];

		const websiteDir = await liberateWebsite( 'https://example.com/', outputBase, {
			loadEngine: async () => loaded,
			onProgress: ( message ) => progress.push( message ),
		} );

		expect( websiteDir ).toBe( path.join( outputBase, 'example.com', 'website' ) );
		expect( loaded.captureWebsite ).toHaveBeenCalledWith(
			expect.objectContaining( {
				url: 'https://example.com/',
				outputDir: path.join( outputBase, 'example.com' ),
			} )
		);
		expect( progress[ 0 ] ).toBe( 'Data Liberation 9.9.9' );
	} );

	it( 'builds the command that compares a site against the original', async () => {
		const outputBase = tempRoot();
		let build: ( ( siteUrl: string ) => string ) | undefined;

		await liberateWebsite( 'https://example.com/', outputBase, {
			loadEngine: async () => engine(),
			onCompareCommand: ( command ) => {
				build = command;
			},
		} );

		expect( build?.( 'http://localhost:8881' ) ).toBe(
			`npx --yes --package=https://example.com/data-liberation-9.9.9.tgz data-liberation compare ${ JSON.stringify(
				path.join( outputBase, 'example.com' )
			) } --candidate http://localhost:8881`
		);
	} );
	it( 'refuses a partial capture that has no capture receipt', async () => {
		const loaded = engine( {
			captureWebsite: vi.fn( async ( { outputDir } ) => ( {
				captureReceiptPath: '',
				outputDir,
				summary: { routesDiscovered: 8, routesCaptured: 7, routesSkipped: 0, routesFailed: 1 },
			} ) ),
		} );

		await expect(
			liberateWebsite( 'https://example.com/', tempRoot(), { loadEngine: async () => loaded } )
		).rejects.toThrow( /did not provide a valid capture receipt/ );
	} );
	it( 'refuses a capture without a usable route summary', async () => {
		const loaded = engine( {
			captureWebsite: vi.fn( async ( { outputDir } ) => ( {
				captureReceiptPath: '',
				outputDir,
			} ) ) as unknown as CaptureEngine[ 'captureWebsite' ],
		} );

		await expect(
			liberateWebsite( 'https://example.com/', tempRoot(), { loadEngine: async () => loaded } )
		).rejects.toThrow( /cannot be confirmed complete/ );
	} );

	it( 'rejects non-HTTP sources before loading the engine', async () => {
		const loadEngine = vi.fn();
		await expect(
			liberateWebsite( 'file:///etc/passwd', tempRoot(), { loadEngine } )
		).rejects.toThrow( 'Source URLs must use HTTP or HTTPS.' );
		expect( loadEngine ).not.toHaveBeenCalled();
	} );
} );

describe( 'compareLiberatedCapture', () => {
	it( 'samples two routes and summarizes the report', async () => {
		const loaded = engine( {
			checkFidelity: vi.fn().mockResolvedValue( {
				pass: false,
				routes: [ '/', '/about/' ],
				scores: [ { failures: [ 'a', 'b' ] }, { failures: [] } ],
				selfConsistency: { routes: 8, findings: [] },
			} ),
		} );

		const result = await compareLiberatedCapture( '/capture', { loadEngine: async () => loaded } );

		expect( loaded.checkFidelity ).toHaveBeenCalledWith(
			expect.objectContaining( { directory: '/capture', sampleSize: 2 } )
		);
		expect( result ).toEqual( {
			pass: false,
			report:
				'2 source check(s) failed across 2 compared route(s); 0 offline finding(s) across 8 route(s).',
		} );
	} );
} );
