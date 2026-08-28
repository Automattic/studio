import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSelfConsistency, summariseFindings } from './self-consistency.js';

const dirs: string[] = [];
afterEach( () => {
	for ( const dir of dirs.splice( 0 ) ) rmSync( dir, { recursive: true, force: true } );
} );

function site( pages: Record< string, string > ): string {
	const dir = mkdtempSync( join( tmpdir(), 'dla-selfcheck-' ) );
	dirs.push( dir );
	for ( const [ path, html ] of Object.entries( pages ) ) {
		mkdirSync( join( dir, path, '..' ), { recursive: true } );
		writeFileSync( join( dir, path ), html );
	}
	return dir;
}

const files = ( ...routes: Array< [ string, string ] > ) => new Map( routes );

describe( 'checkSelfConsistency', () => {
	it( 'accepts a copy whose links, anchors and assets all resolve locally', () => {
		const dir = site( {
			'index.html':
				'<a href="/index.html#team">Team</a><a href="/about/">About</a><img src="/media/a.png"><h2 id="team">Team</h2>',
			'about/index.html': '<a href="/">Home</a>',
			'media/a.png': 'x',
		} );
		const report = checkSelfConsistency(
			dir,
			files( [ '/', 'index.html' ], [ '/about/', 'about/index.html' ] )
		);
		expect( report.findings ).toEqual( [] );
		expect( report.pass ).toBe( true );
		expect( report.routes ).toBe( 2 );
	} );

	it( 'catches a same-page anchor with no target', () => {
		const dir = site( { 'index.html': '<a href="/index.html#missing">Jump</a>' } );
		const report = checkSelfConsistency( dir, files( [ '/', 'index.html' ] ) );
		expect( report.findings ).toEqual( [
			{ route: '/', kind: 'anchor-missing', detail: '/index.html#missing' },
		] );
	} );

	it( 'catches an anchor that matches more than one target', () => {
		// The desktop/mobile collision: the browser picks the first silently.
		const dir = site( {
			'index.html': '<a href="/index.html#team">Team</a><div id="team"></div><div id="team"></div>',
		} );
		const report = checkSelfConsistency( dir, files( [ '/', 'index.html' ] ) );
		expect( report.findings[ 0 ] ).toMatchObject( { kind: 'anchor-ambiguous' } );
		expect( report.findings[ 0 ]?.detail ).toContain( '2 targets' );
	} );

	it( 'catches an internal link with no page behind it', () => {
		const dir = site( { 'index.html': '<a href="/pricing/">Pricing</a>' } );
		const report = checkSelfConsistency( dir, files( [ '/', 'index.html' ] ) );
		expect( report.findings ).toEqual( [
			{ route: '/', kind: 'link-dangling', detail: '/pricing/' },
		] );
	} );

	it( 'leaves links to other sites alone', () => {
		const dir = site( { 'index.html': '<a href="https://wordpress.org/">WP</a><a href="mailto:a@b.c">Mail</a>' } );
		expect( checkSelfConsistency( dir, files( [ '/', 'index.html' ] ) ).pass ).toBe( true );
	} );

	it( 'leaves a canonical link alone, since nothing fetches it', () => {
		const dir = site( {
			'index.html':
				'<link rel="canonical" href="https://rlj107.wixsite.com/createanchors"><h1>Home</h1>',
		} );
		expect( checkSelfConsistency( dir, files( [ '/', 'index.html' ] ) ).pass ).toBe( true );
	} );

	it( 'catches a stylesheet that still points at the origin', () => {
		const dir = site( { 'index.html': '<link rel="stylesheet" href="https://static.example.com/a.css">' } );
		const report = checkSelfConsistency( dir, files( [ '/', 'index.html' ] ) );
		expect( report.findings ).toEqual( [
			{ route: '/', kind: 'remote-asset', detail: 'static.example.com' },
		] );
	} );

	it( 'catches an asset still pointing at the origin', () => {
		const dir = site( { 'index.html': '<img src="https://static.wixstatic.com/media/a.png">' } );
		const report = checkSelfConsistency( dir, files( [ '/', 'index.html' ] ) );
		expect( report.findings ).toEqual( [
			{ route: '/', kind: 'remote-asset', detail: 'static.wixstatic.com' },
		] );
	} );

	it( 'reports a route whose file was never written', () => {
		const dir = site( { 'index.html': '<h1>Home</h1>' } );
		const report = checkSelfConsistency(
			dir,
			files( [ '/', 'index.html' ], [ '/gone/', 'gone/index.html' ] )
		);
		expect( report.findings[ 0 ] ).toMatchObject( { route: '/gone/', kind: 'link-dangling' } );
	} );
} );

describe( 'summariseFindings', () => {
	it( 'groups one broken template instead of printing it per route', () => {
		const findings = Array.from( { length: 60 }, ( _value, index ) => ( {
			route: `/blog/post-${ index }/`,
			kind: 'anchor-missing' as const,
			detail: '#top',
		} ) );
		const [ group ] = summariseFindings( findings );
		expect( group ).toMatchObject( { kind: 'anchor-missing', routes: 60 } );
		expect( group?.examples ).toHaveLength( 3 );
	} );
} );

describe( 'anchor link shapes the exporter actually emits', () => {
	it( 'checks a bare fragment and a rewritten same-page link alike', () => {
		for ( const href of [ '#team', '/index.html#team', 'index.html#team' ] ) {
			const dir = site( { 'index.html': `<a href="${ href }">Team</a><div id="team"></div><div id="team"></div>` } );
			const report = checkSelfConsistency( dir, files( [ '/', 'index.html' ] ) );
			expect( report.findings[ 0 ], href ).toMatchObject( { kind: 'anchor-ambiguous' } );
		}
	} );

	it( 'follows a cross-page anchor to the page that must contain it', () => {
		const dir = site( {
			'index.html': '<a href="/about/#team">Team</a>',
			'about/index.html': '<h1>About</h1>',
		} );
		const report = checkSelfConsistency(
			dir,
			files( [ '/', 'index.html' ], [ '/about/', 'about/index.html' ] )
		);
		expect( report.findings ).toEqual( [
			{ route: '/', kind: 'anchor-missing', detail: '/about/#team' },
		] );
	} );
} );
