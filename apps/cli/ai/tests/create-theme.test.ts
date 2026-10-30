import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { getOpenProblems } from '@studio/agent/node/open-problems';
import { SiteChanges } from '@studio/agent/node/site-changes';
import { createThemeTool } from '@studio/agent/node/tools/create-theme';
import { bindTool } from '@studio/agent/node/tools/define-tool';
import { runWpCli } from '@studio/agent/node/tools/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import type { HostSite, StudioAgentHost } from '@studio/agent/node';

// A real WordPress install to make child themes on, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

// The active theme, its parent, and whether WordPress queues a stylesheet of the parent's on the front end.
const ACTIVE = `do_action( 'wp_enqueue_scripts' );
$styles = wp_styles();
$styles->all_deps( $styles->queue );
$parent = get_template_directory_uri() . '/';
$queued = false;
foreach ( $styles->to_do as $handle ) {
	$queued = $queued || preg_match( '#^' . preg_quote( $parent, '#' ) . 'style(\\.min)?\\.css$#', strtok( (string) $styles->registered[ $handle ]->src, '?' ) );
}
echo wp_json_encode( array( get_stylesheet(), get_template(), $queued ) );`;

describe.runIf( WORDPRESS )( 'create_theme', () => {
	let site: HostSite;
	let host: StudioAgentHost;
	let themes: string;
	const make = ( args: { parent?: string; name: string; slug?: string } ) =>
		bindTool( createThemeTool, host ).rawHandler( { nameOrPath: site.name, ...args } );
	const active = async () =>
		JSON.parse( await runWpCli( host, site, [ 'eval', ACTIVE ] ) ) as [ string, string, boolean ];

	beforeAll( () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'create-theme-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		site = liveSite( root, 'Corner Bakehouse' );
		host = liveHost( site );
		themes = path.join( root, 'wp-content/themes' );
		// A parent that loads its stylesheet by the active theme's URI, as many classic-era themes do.
		mkdirSync( path.join( themes, 'plain' ) );
		writeFileSync( path.join( themes, 'plain/style.css' ), '/*\nTheme Name: Plain\n*/\n' );
		writeFileSync( path.join( themes, 'plain/index.php' ), '<?php' );
		writeFileSync(
			path.join( themes, 'plain/functions.php' ),
			"<?php add_action( 'wp_enqueue_scripts', function () { wp_enqueue_style( 'plain', get_stylesheet_uri() ); } );"
		);
	} );
	afterAll( () => rmSync( site.path, { recursive: true, force: true } ) );

	it( 'makes and activates a block theme that WordPress renders and Studio finds nothing to fix in', async () => {
		const open = getOpenProblems( host, {} );
		const changes = new SiteChanges( host, open, async () => [ site ] );
		await changes.snapshot();
		const made = await make( { name: 'Corner Bakehouse' } );
		expect( ( await changes.settle() ).problems ).toEqual( [] );
		// The result holds each file as written, for the agent to edit without reading it.
		const text = made.content
			.map( ( part ) => ( part.type === 'text' ? part.text : '' ) )
			.join( '' );
		for ( const file of [ 'theme.json', 'parts/header.html', 'templates/page.html' ] ) {
			expect( text ).toContain(
				`wp-content/themes/corner-bakehouse/${ file }:\n~~~\n${ readFileSync(
					path.join( themes, 'corner-bakehouse', file ),
					'utf8'
				).trimEnd() }\n~~~`
			);
		}
		expect( await open.raise() ).toEqual( [] );
		const rendered = JSON.parse(
			await runWpCli( host, site, [
				'eval',
				`$page = wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Menu', 'post_content' => '<!-- wp:paragraph --><p>Sourdough</p><!-- /wp:paragraph -->' ) );
$GLOBALS['wp_query'] = new WP_Query( array( 'page_id' => $page ) );
$GLOBALS['wp_the_query'] = $GLOBALS['wp_query'];
$template = get_block_template( get_stylesheet() . '//page' );
$GLOBALS['_wp_current_template_id'] = $template->id;
$GLOBALS['_wp_current_template_content'] = $template->content;
echo wp_json_encode( array( wp_is_block_theme(), get_the_block_template_html() ) );`,
			] )
		) as [ boolean, string ];
		expect( rendered[ 0 ] ).toBe( true );
		expect( rendered[ 1 ] ).toMatch(
			/<header[^>]*wp-block-template-part[\s\S]*Sourdough[\s\S]*<footer[^>]*wp-block-template-part/
		);
	}, 60_000 );

	it.each( [
		// Twenty Twenty-Five loads its style.css by its own URI (get_parent_theme_file_uri()).
		{ parent: 'twentytwentyfive', name: 'Bakehouse', slug: 'bakehouse', functions: false },
		{ parent: 'plain', name: 'Plain Bakehouse', slug: 'plain-bakehouse', functions: true },
	] )(
		'makes and activates a child of $parent that WordPress serves with its parent’s styles',
		async ( { parent, name, slug, functions } ) => {
			await make( { parent, name } );
			expect( existsSync( path.join( themes, slug, 'functions.php' ) ) ).toBe( functions );
			expect( await active() ).toEqual( [ slug, parent, true ] );
		}
	);

	it.each( [
		{ parent: 'missing', name: 'Missing Child', error: 'No theme missing is installed' },
		{
			parent: 'bakehouse',
			name: 'Grandchild',
			error: 'bakehouse is a child theme of twentytwentyfive',
		},
		{
			parent: 'twentytwentyfour',
			name: 'Bakehouse',
			error: 'wp-content/themes/bakehouse already exists',
		},
	] )( 'refuses $name of $parent', async ( { parent, name, error } ) => {
		await expect( make( { parent, name } ) ).rejects.toThrow( error );
	} );
} );
