import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
	canonicalRoutePath,
	checkFidelity,
	checkWidthsFor,
	resolveCheckDirectory,
	routeSourceMap,
} from './check.js';
import type { LayoutObservation } from './score.js';

const dirs: string[] = [];
afterEach( () => {
	for ( const dir of dirs.splice( 0 ) ) rmSync( dir, { recursive: true, force: true } );
} );

function liberatedRun(): string {
	const dir = mkdtempSync( join( tmpdir(), 'dla-check-' ) );
	dirs.push( dir );
	mkdirSync( join( dir, 'website' ), { recursive: true } );
	writeFileSync( join( dir, 'website', 'index.html' ), '<h1>Home</h1>' );
	writeFileSync(
		join( dir, 'capture-receipt.json' ),
		JSON.stringify( { source: { url: 'https://example.com/' }, websiteRoot: 'website' } )
	);
	return dir;
}

const obs = ( viewport: number, extra: Partial< LayoutObservation > = {} ): LayoutObservation => ( {
	viewport,
	title: 'Home',
	textChars: 10,
	widestImage: viewport,
	images: [],
	docWidth: viewport,
	overflow: false,
	externalHosts: [],
	hashTargets: [],
	internalMissing: [],
	dialogs: [],
	...extra,
} );

describe( 'resolveCheckDirectory', () => {
	it( 'accepts the run directory printed by liberation', () => {
		const run = liberatedRun();
		expect( resolveCheckDirectory( run ).websiteDir ).toBe( join( run, 'website' ) );
	} );

	it( 'accepts the website directory itself', () => {
		const run = liberatedRun();
		expect( resolveCheckDirectory( join( run, 'website' ) ).receiptPath ).toBe(
			join( run, 'capture-receipt.json' )
		);
	} );

	it( 'rejects a directory with no receipt', () => {
		const dir = mkdtempSync( join( tmpdir(), 'dla-check-' ) );
		dirs.push( dir );
		expect( () => resolveCheckDirectory( dir ) ).toThrow( /capture-receipt/ );
	} );
} );

describe( 'canonicalRoutePath', () => {
	it( 'gives a directory index one spelling', () => {
		for ( const route of [ '/', '/index.html' ] ) expect( canonicalRoutePath( route ) ).toBe( '/' );
		for ( const route of [ '/about', '/about/', '/about/index.html' ] )
			expect( canonicalRoutePath( route ) ).toBe( '/about/' );
	} );

	it( 'leaves a real file alone', () => {
		expect( canonicalRoutePath( '/feed.xml' ) ).toBe( '/feed.xml' );
		expect( canonicalRoutePath( 'blog/post.html' ) ).toBe( '/blog/post.html' );
	} );
} );

describe( 'routeSourceMap', () => {
	it( 'maps the copy back to the URLs it was captured from', () => {
		expect( [
			...routeSourceMap( {
				websiteRoot: 'website',
				routes: [
					{ url: 'https://example.com/docs/start', path: 'website/index.html' },
					{ url: 'https://example.com/docs/api', path: 'website/api/index.html' },
				],
			} ),
		] ).toEqual( [
			[ '/', 'https://example.com/docs/start' ],
			[ '/api/', 'https://example.com/docs/api' ],
		] );
	} );
} );

describe( 'checkWidthsFor', () => {
	it( 'drops widths the sweep already sampled', () => {
		expect( checkWidthsFor( [ 1440, 1600, 1920 ] ) ).toEqual( [ 1728 ] );
	} );
} );

describe( 'checkFidelity', () => {
	it( 'scores injected observations at each unsampled width', async () => {
		const seen: number[] = [];
		const report = await checkFidelity( {
			directory: liberatedRun(),
			observe: async ( _source, _local, viewport ) => {
				seen.push( viewport );
				return { source: obs( viewport ), liberated: obs( viewport ) };
			},
		} );
		expect( seen ).toEqual( [ 1600, 1728, 390 ] );
		expect( report.pass ).toBe( true );
		expect( report.sourceUrl ).toBe( 'https://example.com/' );
	} );

	it( 'compares a subpath source against the page it captured, not the origin root', async () => {
		const dir = mkdtempSync( join( tmpdir(), 'dla-check-' ) );
		dirs.push( dir );
		mkdirSync( join( dir, 'website' ), { recursive: true } );
		writeFileSync( join( dir, 'website', 'index.html' ), '<h1>Home</h1>' );
		writeFileSync(
			join( dir, 'capture-receipt.json' ),
			JSON.stringify( {
				source: { url: 'https://example.com/handbook/intro' },
				websiteRoot: 'website',
				routes: [ { url: 'https://example.com/handbook/intro', path: 'website/index.html' } ],
			} )
		);

		const requested: string[] = [];
		await checkFidelity( {
			directory: dir,
			widths: [ 1600 ],
			observe: async ( sourceHref, _local, viewport ) => {
				requested.push( sourceHref );
				return { source: obs( viewport ), liberated: obs( viewport ) };
			},
		} );

		// Every pass asks for the captured page, however many passes there are.
		// Pinning the exact call count is what broke when an interactivity pass
		// was added; the intent is that no pass reaches for the origin root.
		expect( requested.length ).toBeGreaterThan( 0 );
		expect( [ ...new Set( requested ) ] ).toEqual( [ 'https://example.com/handbook/intro' ] );
	} );

	it( 'compares a small sample to the source while checking every route offline', async () => {
		const dir = mkdtempSync( join( tmpdir(), 'dla-check-' ) );
		dirs.push( dir );
		for ( const sub of [ 'website', 'website/about', 'website/blog/a', 'website/blog/b' ] )
			mkdirSync( join( dir, sub ), { recursive: true } );
		const post = ( title: string, paragraphs: number ) =>
			`<html><body><main><article><h1>${ title }</h1>${ '<p>copy</p>'.repeat(
				paragraphs
			) }</article></main></body></html>`;
		writeFileSync(
			join( dir, 'website', 'index.html' ),
			'<html><body><header><nav></nav></header><main><section><h1>Home</h1></section></main></body></html>'
		);
		writeFileSync(
			join( dir, 'website', 'about', 'index.html' ),
			'<html><body><main><aside><p>About</p></aside><ul><li>x</li></ul></main></body></html>'
		);
		// Two posts on one template, differing only in how much copy they carry.
		writeFileSync( join( dir, 'website', 'blog', 'a', 'index.html' ), post( 'A', 3 ) );
		writeFileSync( join( dir, 'website', 'blog', 'b', 'index.html' ), post( 'B', 17 ) );
		writeFileSync(
			join( dir, 'capture-receipt.json' ),
			JSON.stringify( {
				source: { url: 'https://example.com/' },
				websiteRoot: 'website',
				routes: [
					{ url: 'https://example.com/blog/b', path: 'website/blog/b/index.html' },
					{ url: 'https://example.com/', path: 'website/index.html' },
					{ url: 'https://example.com/about', path: 'website/about/index.html' },
					{ url: 'https://example.com/blog/a', path: 'website/blog/a/index.html' },
				],
			} )
		);

		const seen: string[] = [];
		const report = await checkFidelity( {
			directory: dir,
			widths: [ 1600 ],
			observe: async ( sourceHref, _local, viewport ) => {
				seen.push( sourceHref );
				return { source: obs( viewport ), liberated: obs( viewport ) };
			},
		} );

		// Small site: every route fits inside the sample.
		expect( report.routesAvailable ).toBe( 4 );
		expect( report.routes ).toEqual( [ '/', '/about/', '/blog/a/', '/blog/b/' ] );
		expect( seen[ 0 ] ).toBe( 'https://example.com/' );
		// Offline tier covers all of them regardless.
		expect( report.selfConsistency.routes ).toBe( 4 );
	} );

	it( 'spreads the source sample so a large blog does not crowd out other pages', async () => {
		const dir = mkdtempSync( join( tmpdir(), 'dla-check-' ) );
		dirs.push( dir );
		mkdirSync( join( dir, 'website', 'shop' ), { recursive: true } );
		writeFileSync(
			join( dir, 'website', 'index.html' ),
			'<html><body><header><nav></nav></header><main><h1>Home</h1></main></body></html>'
		);
		// Sixty posts sort ahead of /shop/, so route-order selection never reached it.
		const routes = [ { url: 'https://example.com/', path: 'website/index.html' } ];
		for ( let index = 0; index < 60; index++ ) {
			const slug = `blog/post-${ String( index ).padStart( 3, '0' ) }`;
			mkdirSync( join( dir, 'website', slug ), { recursive: true } );
			writeFileSync(
				join( dir, 'website', slug, 'index.html' ),
				`<html><body><main><article><h1>Post ${ index }</h1>${ '<p>copy</p>'.repeat(
					index + 1
				) }</article></main></body></html>`
			);
			routes.push( { url: `https://example.com/${ slug }`, path: `website/${ slug }/index.html` } );
		}
		writeFileSync(
			join( dir, 'website', 'shop', 'index.html' ),
			'<html><body><main><section><h2>Shop</h2><ul><li>item</li></ul></section><aside><form></form></aside></main></body></html>'
		);
		routes.push( { url: 'https://example.com/shop', path: 'website/shop/index.html' } );
		writeFileSync(
			join( dir, 'capture-receipt.json' ),
			JSON.stringify( { source: { url: 'https://example.com/' }, websiteRoot: 'website', routes } )
		);

		const report = await checkFidelity( {
			directory: dir,
			widths: [ 1600 ],
			observe: async ( _source, _local, viewport ) => ( {
				source: obs( viewport ),
				liberated: obs( viewport ),
			} ),
		} );

		// Ordered selection spent every check inside /blog/; an even spread reaches /shop/.
		expect( report.routesAvailable ).toBe( 62 );
		expect( report.routes[ 0 ] ).toBe( '/' );
		expect( report.routes ).toContain( '/shop/' );
		expect( report.routes ).toHaveLength( 4 );
		// And every one of the 62 routes was checked offline.
		expect( report.selfConsistency.routes ).toBe( 62 );
	} );

	it( 'refuses to compare a route the capture never took', async () => {
		await expect(
			checkFidelity( {
				directory: liberatedRun(),
				routes: [ '/pricing' ],
				widths: [ 1600 ],
				observe: async ( _source, _local, viewport ) => ( {
					source: obs( viewport ),
					liberated: obs( viewport ),
				} ),
			} )
		).rejects.toThrow( /was not captured/ );
	} );

	it( 'fails the report when any viewport freezes', async () => {
		const report = await checkFidelity( {
			directory: liberatedRun(),
			widths: [ 1600 ],
			observe: async ( _source, _local, viewport ) => ( {
				source: obs( viewport ),
				liberated: obs( viewport, { widestImage: 1440 } ),
			} ),
		} );
		expect( report.pass ).toBe( false );
		expect( report.failed ).toBe( 1 );
	} );

	it( 'fails the report when the copy renders fewer images than the source', async () => {
		const slides = ( viewport: number ) => [
			{ key: 'slide-a.jpg', x: 0, y: 96, width: viewport, height: 600 },
			{ key: 'slide-b.jpg', x: 0, y: 96, width: viewport, height: 600 },
		];
		const report = await checkFidelity( {
			directory: liberatedRun(),
			widths: [ 1600 ],
			observe: async ( _source, _local, viewport ) => ( {
				source: obs( viewport, { images: slides( viewport ) } ),
				liberated: obs( viewport, { images: [] } ),
			} ),
		} );
		expect( report.pass ).toBe( false );
		expect( report.scores[ 0 ]?.failures[ 0 ] ).toMatch( /^images 2 of 2 missing: slide-a\.jpg/ );
	} );

	it( 'records a pixel score as evidence without letting it fail the gate', async () => {
		const black = new PNG( { width: 4, height: 4 } );
		const white = new PNG( { width: 4, height: 4 } );
		for ( let i = 0; i < black.data.length; i += 4 ) {
			black.data[ i + 3 ] = 255;
			white.data[ i ] = 255;
			white.data[ i + 1 ] = 255;
			white.data[ i + 2 ] = 255;
			white.data[ i + 3 ] = 255;
		}
		const report = await checkFidelity( {
			directory: liberatedRun(),
			widths: [ 1600 ],
			observe: async ( _source, _local, viewport ) => ( {
				source: obs( viewport ),
				liberated: obs( viewport ),
				sourcePng: PNG.sync.write( black ),
				liberatedPng: PNG.sync.write( white ),
			} ),
		} );
		expect( report.pass ).toBe( true );
		expect( report.scores[ 0 ]?.notes.join( ' ' ) ).toMatch( /evidence, not a gate/ );
	} );
} );
