import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { inlineBlockClasses } from '@studio/agent/node/inline-block-classes';
import { runWpCli } from '@studio/agent/node/tools/utils';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import type { HostSite, StudioAgentHost } from '@studio/agent/node';

// A real WordPress install to render the site's blocks with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

const group = ( className: string ) =>
	`<!-- wp:group {"className":"${ className }"} --><div class="wp-block-group ${ className }"></div><!-- /wp:group -->`;

describe.runIf( WORDPRESS )( "block classes the theme's stylesheets make inline-level", () => {
	let site: HostSite;
	let host: StudioAgentHost;
	const check = () => inlineBlockClasses.check( site, { code: 'a' }, { code: 'b' }, host );
	beforeAll( () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'inline-block-classes-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		site = liveSite( root, 'Ember Roasters' );
		host = liveHost( site );
	} );
	afterAll( () => rmSync( site.path, { recursive: true, force: true } ) );

	it( 'asks WordPress for no blocks while no stylesheet makes a class inline-level', async () => {
		const ask = vi.spyOn( host.sites, 'wpCli' );
		expect( ( await check() ).reports[ 0 ].problem ).toBeUndefined();
		expect( ask ).not.toHaveBeenCalled();
		ask.mockRestore();
	} );

	it( 'names a block class the stylesheets make inline-level, written before the block', async () => {
		// A child theme, so the parent's stylesheets count too.
		const parent = ( await runWpCli( host, site, [ 'eval', 'echo get_template();' ] ) ).trim();
		const child = path.join( site.path, 'wp-content/themes/studio-test-child' );
		mkdirSync( path.join( child, 'templates' ), { recursive: true } );
		writeFileSync(
			path.join( child, 'style.css' ),
			`/*\nTheme Name: Child\nTemplate: ${ parent }\n*/`
		);
		writeFileSync( path.join( child, 'templates/index.html' ), '' );
		writeFileSync( path.join( child, 'chip.css' ), '.er-chip { display: inline-flex; }' );
		await runWpCli( host, site, [ 'theme', 'activate', 'studio-test-child' ] );
		const before = await inlineBlockClasses.read( site.path, undefined, host );
		const css = path.join( site.path, 'wp-content/themes', parent, 'studio-test-pill.css' );
		writeFileSync( css, '.er-pill { display: inline-block; }\n.er-wide { display: block; }' );
		expect( ( await inlineBlockClasses.read( site.path, undefined, host ) ).code ).not.toBe(
			before.code
		);
		const id = (
			await runWpCli( host, site, [
				'eval',
				`echo wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Pill', 'post_content' => ${ JSON.stringify(
					group( 'er-pill' ) + group( 'er-wide' ) + group( 'er-chip' )
				) } ) );`,
			] )
		).trim();
		const { reports, next } = await check();
		// Each note its own problem, so one fixed leaves the other as it was raised.
		const inline = reports.filter( ( report ) => report.problem );
		expect( inline ).toHaveLength( 2 );
		for ( const report of inline ) {
			expect( report.key ).toMatch( /^inline block classes / );
			expect( report.atTurnEnd ).toBe( true );
			expect( report.problem ).toMatch( /^Ember Roasters: / );
		}
		expect( inline.map( ( report ) => report.problem ).join( '\n' ) ).toContain(
			`${ css }: \`.er-pill\` is a block className and gets an inline-level display, and a block with it sits directly in a constrained layout.`
		);
		expect( inline.map( ( report ) => report.problem ).join( '\n' ) ).toContain(
			`${ path.join( child, 'chip.css' ) }: \`.er-chip\` is a block className`
		);
		expect( JSON.stringify( reports ) ).not.toContain( 'er-wide' );
		// The class leaves the blocks, and the notes go with it.
		await runWpCli( host, site, [ 'post', 'delete', id, '--force' ] );
		const cleared = await inlineBlockClasses.check( site, next!, { ...next!, code: 'c' }, host );
		expect( cleared.reports.map( ( report ) => report.key ).sort() ).toEqual(
			[ 'inline block classes', ...inline.map( ( report ) => report.key ) ].sort()
		);
		expect( cleared.reports.every( ( report ) => ! report.problem ) ).toBe( true );
		rmSync( css );
		await runWpCli( host, site, [ 'theme', 'activate', parent ] );
		rmSync( child, { recursive: true } );
	}, 120000 );

	// eval30 pileon: the session's hero kicker, a paragraph in a column, whose
	// flow layout places it with no auto margins, was noted as leaving the
	// content column.
	it( 'names a class only on a block that sits directly in a constrained layout', async () => {
		const theme = ( await runWpCli( host, site, [ 'eval', 'echo get_stylesheet();' ] ) ).trim();
		const css = path.join( site.path, 'wp-content/themes', theme, 'studio-test-hero.css' );
		writeFileSync(
			css,
			'.hero-kicker {\n\tdisplay: inline-flex;\n\talign-items: center;\n\tgap: 0.5rem;\n\tborder-radius: 999px;\n\tpadding: 0.5rem 1rem;\n}'
		);
		const kicker =
			'<!-- wp:paragraph {"className":"hero-kicker"} -->\n<p class="hero-kicker">🐾 Portland&rsquo;s friendliest grooming</p>\n<!-- /wp:paragraph -->';
		const hero = ( column: string ) =>
			`<!-- wp:group {"align":"full","className":"hero","layout":{"type":"constrained","contentSize":"1180px"}} -->\n<div class="wp-block-group alignfull hero"><!-- wp:columns {"verticalAlignment":"center","className":"hero-inner"} -->\n<div class="wp-block-columns are-vertically-aligned-center hero-inner"><!-- wp:column {"verticalAlignment":"center"} -->\n<div class="wp-block-column is-vertically-aligned-center">${ column }\n\n<!-- wp:heading {"level":1} -->\n<h1 class="wp-block-heading">A good day starts with a great bath.</h1>\n<!-- /wp:heading --></div>\n<!-- /wp:column --></div>\n<!-- /wp:columns --></div>\n<!-- /wp:group -->`;
		const page = async ( content: string ) =>
			(
				await runWpCli( host, site, [
					'eval',
					`echo wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Home', 'post_content' => ${ JSON.stringify(
						content
					) } ) );`,
				] )
			).trim();
		const notes = async () =>
			( await check() ).reports
				.filter( ( report ) => report.problem )
				.map( ( report ) => report.problem )
				.join( '\n' );

		const inColumn = await page( hero( kicker ) );
		expect( await notes() ).not.toContain( '`.hero-kicker`' );
		await runWpCli( host, site, [ 'post', 'delete', inColumn, '--force' ] );

		const inGroup = await page(
			hero(
				`<!-- wp:group {"layout":{"type":"constrained"}} -->\n<div class="wp-block-group">${ kicker }</div>\n<!-- /wp:group -->`
			)
		);
		expect( await notes() ).toContain(
			`${ css }: \`.hero-kicker\` is a block className and gets an inline-level display, and a block with it sits directly in a constrained layout.`
		);
		await runWpCli( host, site, [ 'post', 'delete', inGroup, '--force' ] );
		rmSync( css );
	}, 120000 );

	it( 'asks WordPress only when the code or content changed', async () => {
		const versions = { code: 'a', content: 'b' };
		expect( await inlineBlockClasses.check( site, versions, { ...versions }, host ) ).toEqual( {
			reports: [],
			next: { ...versions, raised: '[]' },
		} );
	} );
} );
