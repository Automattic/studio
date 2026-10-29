import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { createChildThemeTool } from '@studio/agent/node/tools/create-child-theme';
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

describe.runIf( WORDPRESS )( 'create_child_theme', () => {
	let site: HostSite;
	let host: StudioAgentHost;
	let themes: string;
	const make = ( args: { parent: string; name: string; slug?: string } ) =>
		bindTool( createChildThemeTool, host ).rawHandler( { nameOrPath: site.name, ...args } );
	const active = async () =>
		JSON.parse( await runWpCli( host, site, [ 'eval', ACTIVE ] ) ) as [ string, string, boolean ];

	beforeAll( () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'create-child-theme-' ) );
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
