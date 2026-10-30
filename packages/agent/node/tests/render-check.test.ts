import { appendFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { OpenProblems } from '@studio/agent/node/open-problems';
import { RenderCheck } from '@studio/agent/node/render-check';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import type { HostSite } from '@studio/agent/node/host';

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
		return check.takeReports();
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
		expect( check.takeReports() ).toBe( '' );
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
		expect( check.takeReports() ).toBe( '' );

		release();
		await check.settle();
		expect( check.takeReports() ).toContain( '- / (desktop): current' );
	} );

	it( 'renders nothing while the site is stopped', async () => {
		const { site, check, inspect, after } = setup( { running: false } );
		await check.seen( site.root );
		expect( await after() ).toBe( '' );
		expect( inspect ).not.toHaveBeenCalled();
	} );
} );
