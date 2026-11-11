import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { globalStylesFlag } from '@studio/agent/node/global-styles-flag';
import { postCopies, postCopiesFact } from '@studio/agent/node/post-copies';
import { resolvedStyles } from '@studio/agent/node/resolved-styles';
import { SiteChanges } from '@studio/agent/node/site-changes';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import type { HostSite, StudioAgentHost } from '@studio/agent/node';

vi.mock( 'cli/lib/cli-config/sites', () => ( {
	findSiteByFolder: vi.fn( async ( folder: string ) =>
		folder === site.path ? site : undefined
	),
} ) );

// A real WordPress install, on Twenty Twenty-Five, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;
const RESOLVES = "WordPress now resolves the site's styles to:";

let root: string;
let config: string;
let site: HostSite;
let host: StudioAgentHost;
let check: SiteChanges;

// The notes each call left, for a reader of the run, when RESOLVED_STYLES_LOG names a file.
const log = ( ...parts: unknown[] ) =>
	process.env.RESOLVED_STYLES_LOG &&
	appendFileSync( process.env.RESOLVED_STYLES_LOG, parts.join( ' ' ) + '\n' );

const wp = async ( ...args: string[] ) => {
	const { exitCode, stdout, stderr } = await host.sites.wpCli( site, args );
	expect( exitCode, stderr ).toBe( 0 );
	return stdout.trim();
};

describe.runIf( WORDPRESS )( 'the styles WordPress resolves after a call changed them', () => {
	beforeEach( async () => {
		config = mkdtempSync( path.join( os.tmpdir(), 'studio-config-' ) );
		vi.stubEnv( 'DEV_CONFIG_DIR', config );
		root = mkdtempSync( path.join( os.tmpdir(), 'resolved-styles-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		site = liveSite( root, 'Seaside', 'live' );
		host = liveHost( site );
		check = new SiteChanges( host, undefined, async () => [ site ], [
			globalStylesFlag,
			postCopies,
			resolvedStyles,
		] );
	} );
	afterEach( () => {
		vi.unstubAllEnvs();
		rmSync( root, { recursive: true, force: true } );
		rmSync( config, { recursive: true, force: true } );
	} );

	it( "states them after an edit to the active theme's theme.json", async () => {
		// WP-CLI started, as an earlier call of a session starts it.
		await wp( 'eval', 'echo 1;' );
		await check.snapshot();
		const file = path.join( root, 'wp-content/themes/twentytwentyfive/theme.json' );
		const theme = JSON.parse( readFileSync( file, 'utf8' ) );
		theme.styles.elements.heading.typography.fontFamily = 'var:preset|font-family|fira-code';
		writeFileSync( file, JSON.stringify( theme, null, '\t' ) );
		const { summaries, problems } = await check.settle();
		const taken = check.takeSourceMs();
		const ms = taken[ 'check resolved styles' ];
		log( 'read ms', taken[ 'read resolved styles' ] );
		log( 'theme.json edit:', JSON.stringify( { summaries, problems, ms } ) );
		expect( summaries ).toEqual( [
			expect.stringContaining(
				`This call changed twentytwentyfive/theme.json. ${ RESOLVES } body text Manrope`
			),
		] );
		expect( summaries[ 0 ] ).toContain( 'headings Fira Code ("Fira Code", monospace), weight 400' );
		expect( summaries[ 0 ] ).not.toContain( 'This save changed' );
		expect( problems ).toEqual( [] );
	}, 120000 );

	it( 'states them, and what resolves to nothing, after WP-CLI updates the Global Styles post', async () => {
		// The theme's post, as WordPress makes it.
		const id = await wp( 'eval', 'echo WP_Theme_JSON_Resolver::get_user_global_styles_post_id();' );
		await check.snapshot();
		// Saved as the agent saves it, with `wp post update`: no flag.
		await wp(
			'post',
			'update',
			id,
			`--post_content=${ JSON.stringify( {
				version: 3,
				styles: { elements: { link: { color: { text: 'var:preset|color|brand' } } } },
			} ) }`
		);
		const { summaries, problems } = await check.settle();
		const taken = check.takeSourceMs();
		const ms = taken[ 'check resolved styles' ];
		log( 'read ms', taken[ 'read resolved styles' ] );
		log( 'wp post update:', JSON.stringify( { summaries, problems, ms } ) );
		const stated = summaries.filter( ( summary ) => summary.includes( RESOLVES ) );
		expect( stated ).toEqual( [
			expect.stringContaining( `This call changed Global Styles post ${ id }. ${ RESOLVES }` ),
		] );
		expect( stated[ 0 ] ).toContain( 'links unresolved' );
		expect( problems ).toContainEqual(
			expect.stringContaining(
				'styles.elements.link.color.text is "var:preset|color|brand", which WordPress resolves to nothing, so browsers treat that property as unset: it names --wp--preset--color--brand: the site has no "brand" in settings.color.palette'
			)
		);
	}, 120000 );

	it( 'states nothing of them after a call that changed only a page', async () => {
		const id = await wp(
			'post',
			'create',
			'--post_type=page',
			'--post_title=About',
			'--porcelain'
		);
		await check.snapshot();
		const evals = vi.spyOn( host.sites, 'wpCli' );
		await wp(
			'post',
			'update',
			id,
			'--post_content=<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->'
		);
		const { summaries, problems } = await check.settle();
		const taken = check.takeSourceMs();
		const ms = taken[ 'check resolved styles' ];
		log( 'read ms', taken[ 'read resolved styles' ] );
		log( 'page edit:', JSON.stringify( { summaries, problems, ms } ) );
		expect( summaries.join( '\n' ) ).not.toContain( RESOLVES );
		expect( problems.join( '\n' ) ).not.toContain( 'resolves to nothing' );
		// The checks ran no `wp eval`: the one call is the page's update.
		expect( evals ).toHaveBeenCalledTimes( 1 );
	}, 120000 );

	it( 'states them once after a save of the workspace copy', async () => {
		await readWordPressSite( root, ( wp ) => postCopiesFact( wp, host ) );
		await check.snapshot();
		writeFileSync(
			path.join( config, 'workspace', 'live', 'wp_global_styles', 'twentytwentyfive.json' ),
			JSON.stringify( {
				version: 3,
				isGlobalStylesUserThemeJSON: true,
				styles: { elements: { link: { color: { text: '#503AA8' } } } },
			} )
		);
		const { summaries } = await check.settle();
		log( 'copy save:', JSON.stringify( summaries ) );
		const stated = summaries.filter( ( summary ) => summary.includes( RESOLVES ) );
		expect( stated ).toHaveLength( 1 );
		expect( stated[ 0 ] ).toContain( 'This save changed: links.' );
	}, 120000 );
} );
