import { appendFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { OpenProblems } from '@studio/agent/node/open-problems';
import { RenderCheck } from '@studio/agent/node/render-check';
import { PendingWork } from '@studio/agent/node/runtime/pending-work';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import type { HostSite } from '@studio/agent/shared/host';

// A site with an About page, whose server answers, and a browser that finds
// the problems the test sets for each page and viewport.
function setup( { running = true } = {} ) {
	const site = createSite();
	site.save( 5, 'page', 'about', '', 1, 'publish', 'About' );
	const hostSite = { path: site.root, url: 'http://localhost:8881', name: 'Bakery' } as HostSite;
	const host = createFakeHost();
	vi.mocked( host.sites.findByFolder ).mockResolvedValue( hostSite );
	vi.mocked( host.sites.isRunning ).mockResolvedValue( running );
	const problems: Record< string, string[] > = {};
	const inspect = vi.fn( async ( url: string, viewport: string ) => {
		const at = url.endsWith( '?page_id=5' ) ? 'http://localhost:8881/about/' : url;
		return { url: at, problems: problems[ `${ new URL( at ).pathname } ${ viewport }` ] ?? [] };
	} );
	const open = new OpenProblems( [] );
	const check = new RenderCheck( host, open, inspect );
	// A change to what the site renders from, as a theme file written.
	const change = () =>
		appendFileSync( path.join( site.root, 'wp-content/themes/bakery/style.css' ), '\n' );
	const after = async () => {
		change();
		await check.changed( site.root );
		await check.settle();
		return await check.takeReports();
	};
	return { site, check, open, problems, inspect, after };
}

describe( 'RenderCheck', () => {
	it( 'reports what a change broke, not what the site had, and then that nothing is wrong', async () => {
		const { site, check, open, problems, after } = setup();
		problems[ '/ mobile' ] = [ 'The page is 1210px wide in a 390px viewport.' ];
		await check.seen( site.root );

		problems[ '/ mobile' ] = [ 'The page is 1400px wide in a 390px viewport.' ];
		problems[ '/about/ desktop' ] = [ 'The image http://localhost:8881/a.jpg did not load.' ];
		const broken = await after();
		expect( broken ).toContain( 'Studio rendered /, /about/ at desktop and mobile' );
		expect( broken ).toContain(
			'- /about/ (desktop): The image http://localhost:8881/a.jpg did not load.'
		);
		expect( broken ).not.toContain( 'wide' );
		expect( await open.raise() ).toHaveLength( 1 );

		problems[ '/about/ desktop' ] = [];
		expect( await after() ).toMatch(
			/after the last change: each page loads, .* past what the site had before\.$/
		);
		expect( await open.raise() ).toEqual( [] );
		expect( await check.takeReports() ).toBe( '' );
	} );

	// As eval16's dental run 3 asked for text between two sizes and never saw it render at either.
	it( 'states the size body text renders at, by viewport', async () => {
		const { site, check, inspect, after } = setup();
		await check.seen( site.root, { created: true } );
		const sizes: Record< string, number > = {
			'/ desktop': 19.2,
			'/about/ desktop': 18,
			'/ mobile': 17,
		};
		inspect.mockImplementation( async ( url, viewport ) => {
			const at = url.endsWith( '?page_id=5' ) ? '/about/' : '/';
			return { url, problems: [], bodyFontSize: sizes[ `${ at } ${ viewport }` ] };
		} );
		expect( ( await after() ).split( '\n' ).at( -1 ) ).toBe(
			'Body text renders at 19.2px on desktop, 17px on mobile.'
		);
	} );

	it( 'keeps a failed query-addressed page distinct from the homepage', async () => {
		const { site, check, inspect, after } = setup();
		await check.seen( site.root, { created: true } );
		inspect.mockImplementation( async ( url ) => {
			if ( url.endsWith( '?page_id=5' ) ) {
				throw new Error( 'Page load timed out' );
			}
			return { url, problems: [] };
		} );
		const report = await after();
		expect( report ).toContain( '  Seen on:\n  /?page_id=5 — desktop; mobile' );
		expect( report ).not.toContain( '  / —' );
	} );

	it( 'groups identical contrast observations while keeping every location and distinct finding', async () => {
		const { site, check, open, problems, after } = setup();
		await check.seen( site.root, { created: true } );
		const contrast = ( y: number, text = '#ffffff', ratio = '1.0', explanation = '' ) =>
			`  a "Bakery", at y ${ y }, is ${ text } text on #ffffff, a contrast ratio of ${ ratio }:1.${ explanation }`;
		problems[ '/ desktop' ] = [ contrast( -2 ), contrast( 12 ) ];
		problems[ '/ mobile' ] = [ contrast( 30 ) ];
		const distinct = [
			contrast( 40, '#fefefe' ),
			contrast( 50, '#ffffff', '1.1' ),
			contrast( 60, '#ffffff', '1.0', ' Its section sets the text color #000000.' ),
			'The image http://localhost:8881/a.jpg did not load.',
		];
		problems[ '/about/ desktop' ] = [ contrast( 70 ), ...distinct ];
		const report = await after();
		expect( report ).toContain(
			'- a "Bakery": #ffffff text on #ffffff, a contrast ratio of 1.0:1.\n' +
				'  Seen on:\n  / — desktop y-2; desktop y12; mobile y30\n  /about/ — desktop y70'
		);
		expect( report.match( /Seen on:/g ) ).toHaveLength( 1 );
		for ( const problem of distinct ) {
			expect( report ).toContain( `- /about/ (desktop): ${ problem }` );
		}
		expect( await open.raise() ).toEqual( [ report ] );
	} );

	// eval29 redo port 3: a marquee's text at x -16, then x -18, reopened the turn.
	it( 'raises a render problem again only for a finding not raised before', async () => {
		const { site, check, open, problems, after } = setup();
		await check.seen( site.root, { created: true } );
		const edge = ( x: number ) =>
			`span "Bakery": its text starts at the viewport's left edge (x ${ x }).`;
		problems[ '/ desktop' ] = [
			edge( -16 ),
			'The image http://localhost:8881/a.jpg did not load.',
		];
		await after();
		expect( await open.raise() ).toHaveLength( 1 );
		problems[ '/ desktop' ] = [ edge( -18 ) ];
		await after();
		expect( await open.raise() ).toEqual( [] );
		problems[ '/ desktop' ] = [ edge( -24 ), 'The page did not load: timeout.' ];
		const report = await after();
		expect( await open.raise() ).toEqual( [ report ] );
	} );

	// eval28 redo port 1: a footer's email broke on every page, each line repeated per page.
	it( 'lists a problem identical across pages once, with each page and viewport it is on', async () => {
		const { site, check, problems, after } = setup();
		await check.seen( site.root, { created: true } );
		const email =
			'p: the browser breaks "ink@blacklanterntattoo.com" across lines, as the word (214px) is wider than its box (180px).';
		const large =
			'p "Every tattoo starts with a conversation,…" is 48px, 3 times the 16px body text; text this large reads as a heading.';
		problems[ '/ desktop' ] = [ email ];
		problems[ '/ mobile' ] = [ email ];
		problems[ '/about/ mobile' ] = [ email ];
		problems[ '/about/ desktop' ] = [ large ];
		const report = await after();
		expect( report ).toContain(
			`- ${ email }\n  Seen on:\n  / — desktop; mobile\n  /about/ — mobile`
		);
		expect( report.match( /Seen on:/g ) ).toHaveLength( 1 );
		expect( report ).toContain( `- /about/ (desktop): ${ large }` );
	} );

	// eval29 redo port 4: the heading of text against the viewport's edge was
	// listed once with every page and no lines, each of its lines on its own.
	it( 'lists a heading with its lines, identical across pages, once with each page it is on', async () => {
		const { site, check, problems, after } = setup();
		await check.seen( site.root, { created: true } );
		// As inspectPage states it: the heading and its lines, one problem.
		const edges = [
			"Text against the viewport's edge:",
			`  a "Black Lantern Tattoo": its text starts at the viewport's left edge (x 0).`,
		].join( '\n' );
		problems[ '/ desktop' ] = [ edges ];
		problems[ '/ mobile' ] = [ edges ];
		problems[ '/about/ desktop' ] = [ edges ];
		const report = await after();
		expect( report ).toContain(
			`- ${ edges }\n  Seen on:\n  / — desktop; mobile\n  /about/ — desktop`
		);
		expect( report.match( /Seen on:/g ) ).toHaveLength( 1 );
	} );

	// As run h2h5's dog groomer changed an option while its images were being generated.
	it( 'renders once the images being generated in the site are written', async () => {
		const { site, check, problems } = setup();
		await check.seen( site.root, { created: true } );
		problems[ '/ desktop' ] = [ 'The image http://localhost:8881/hero.png did not load.' ];
		let written: () => void = () => {};
		const work = new PendingWork();
		work.add(
			new Promise( ( resolve ) => {
				written = () => {
					problems[ '/ desktop' ] = [];
					resolve( undefined );
				};
			} ),
			// As generate_images names them: paths in the site.
			[ 'wp-content/uploads/2026/10/hero.png' ],
			site.root
		);
		appendFileSync( path.join( site.root, 'wp-content/themes/bakery/style.css' ), '\n' );
		await check.changed( site.root, work );
		setTimeout( written, 50 );
		await check.settle();
		expect( await check.takeReports() ).toMatch( /: each page loads, .* every image loads/ );
	} );

	it( 'reports every problem on a site the session created', async () => {
		const { site, check, problems, inspect, after } = setup();
		await check.seen( site.root, { created: true } );
		expect( inspect ).not.toHaveBeenCalled();

		problems[ '/ mobile' ] = [ 'The page is 1400px wide in a 390px viewport.' ];
		expect( await after() ).toContain( '- / (mobile): The page is 1400px wide' );
	} );

	it( 'drops a render a later change makes stale, and renders again', async () => {
		const { site, check, problems, inspect } = setup();
		await check.seen( site.root, { created: true } );
		// Each render's page loads wait for the test to let them finish.
		let release: () => void = () => {};
		let held = new Promise< void >( ( resolve ) => ( release = resolve ) );
		const inspectNow = inspect.getMockImplementation()!;
		inspect.mockImplementation( async ( ...args ) => {
			const result = inspectNow( ...args );
			await held;
			return result;
		} );
		problems[ '/ desktop' ] = [ 'stale' ];
		appendFileSync( path.join( site.root, 'wp-content/themes/bakery/style.css' ), '\n' );
		await check.changed( site.root );
		problems[ '/ desktop' ] = [ 'current' ];
		appendFileSync( path.join( site.root, 'wp-content/themes/bakery/style.css' ), '\n' );
		await check.changed( site.root );

		// The first render finishes after the second change: nothing to report yet.
		const first = release;
		held = new Promise< void >( ( resolve ) => ( release = resolve ) );
		first();
		await vi.waitFor( () => expect( inspect ).toHaveBeenCalledTimes( 8 ) );
		expect( await check.takeReports() ).toBe( '' );

		release();
		await check.settle();
		expect( await check.takeReports() ).toContain( '- / (desktop): current' );
	} );

	// eval26 redo4: a screenshot was told again of a page 392px wide, which an
	// older render found, while the render of the change that fixed it ran.
	it( 'keeps what a render found out of the open problems while a later change is rendered', async () => {
		const { site, check, open, problems, inspect } = setup();
		await check.seen( site.root, { created: true } );
		problems[ '/ mobile' ] = [ 'The page is 392px wide in a 390px viewport.' ];
		appendFileSync( path.join( site.root, 'wp-content/themes/bakery/style.css' ), '\n' );
		await check.changed( site.root );
		await check.settle();
		expect( check.hasReports() ).toBe( true );
		expect( open.look() ).toEqual( [] );

		let release: () => void = () => {};
		const held = new Promise< void >( ( resolve ) => ( release = resolve ) );
		const inspectNow = inspect.getMockImplementation()!;
		inspect.mockImplementation( async ( ...args ) => {
			await held;
			return inspectNow( ...args );
		} );
		problems[ '/ mobile' ] = [];
		appendFileSync( path.join( site.root, 'wp-content/themes/bakery/style.css' ), '\n' );
		await check.changed( site.root );
		expect( open.look() ).toEqual( [] );
		release();
		await check.settle();
	} );

	// eval9 picky 2: the render of one Edit came with the result of the next,
	// which had fixed what it found, and read as that fix's.
	it( 'drops a verdict a later change has made stale, for the render of that change', async () => {
		const { site, check, problems } = setup();
		await check.seen( site.root );
		problems[ '/ desktop' ] = [ 'stale' ];
		appendFileSync( path.join( site.root, 'wp-content/themes/bakery/style.css' ), '\n' );
		await check.changed( site.root );
		await check.settle();

		problems[ '/ desktop' ] = [];
		appendFileSync( path.join( site.root, 'wp-content/themes/bakery/style.css' ), '\n' );
		expect( await check.takeReports() ).toBe( '' );
		await check.changed( site.root );
		await check.settle();
		expect( await check.takeReports() ).toMatch( /: each page loads/ );
	} );

	it( 'renders nothing while the site is stopped', async () => {
		const { site, check, inspect, after } = setup( { running: false } );
		await check.seen( site.root );
		expect( await after() ).toBe( '' );
		expect( inspect ).not.toHaveBeenCalled();
	} );
} );
