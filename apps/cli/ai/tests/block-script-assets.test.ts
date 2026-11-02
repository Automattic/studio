import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { blockScriptAssets } from '@studio/agent/node/block-script-assets';
import { runWpCli } from '@studio/agent/node/tools/utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import type { HostSite, StudioAgentHost } from '@studio/agent/node';

// A real WordPress install to register blocks with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

const PLUGIN = `<?php
/**
 * Plugin Name: Opening hours
 */
add_action( 'init', function () { register_block_type( __DIR__ ); } );
`;

const BLOCK_JSON = JSON.stringify( {
	apiVersion: 3,
	name: 'bakehouse/opening-hours',
	title: 'Opening hours',
	editorScript: 'file:./src/index.js',
} );

// As the custom-block-plugin eval's plugin of h2h2 wrote it, with no build:
// the editor threw "Cannot read properties of undefined (reading 'blocks')".
const NO_BUILD = `( function ( wp ) {
	const { registerBlockType } = wp.blocks;
	const { useBlockProps } = wp.blockEditor;
	const el = wp.element.createElement;
	wp.notAPackage;
	registerBlockType( 'bakehouse/opening-hours', { edit: () => el( 'p', useBlockProps(), 'Hours' ) } );
} )( window.wp );
`;

// What WordPress prints up to the block's editor script, and whether a browser would load the script again once edited.
const LOADS = `do_action( 'enqueue_block_editor_assets' );
$handle = WP_Block_Type_Registry::get_instance()->get_registered( 'bakehouse/opening-hours' )->editor_script_handles[0];
wp_scripts()->all_deps( array( $handle ) );
echo wp_json_encode( array_slice( wp_scripts()->to_do, 0, array_search( $handle, wp_scripts()->to_do, true ) + 1 ) );
echo "\n" . ( wp_scripts()->registered[ $handle ]->ver === (string) filemtime( WP_PLUGIN_DIR . '/opening-hours/src/index.js' ) ? 'edited script loads again' : 'cached' );`;

describe.runIf( WORDPRESS )(
	'the asset files of block editor scripts written with no build',
	() => {
		let site: HostSite;
		let host: StudioAgentHost;
		let dir: string;
		beforeEach( () => {
			const root = mkdtempSync( path.join( os.tmpdir(), 'block-script-assets-' ) );
			cpSync( WORDPRESS!, root, { recursive: true } );
			site = liveSite( root, 'Corner Bakehouse' );
			host = liveHost( site );
			dir = path.join( root, 'wp-content/plugins/opening-hours' );
		} );
		afterEach( () => rmSync( site.path, { recursive: true, force: true } ) );

		it.each( [
			{
				name: 'a script reading packages from wp gets the asset file naming them',
				script: NO_BUILD,
				asset: undefined,
				written: true,
				loadsAfter: [ 'wp-block-editor', 'wp-blocks', 'wp-element' ],
			},
			{
				name: 'a script that imports modules is left to its build',
				script: `import x from 'y';\n${ NO_BUILD }`,
				asset: undefined,
				written: false,
				loadsAfter: [],
			},
			{
				name: 'a script with an asset file keeps it',
				script: NO_BUILD,
				asset: "<?php return array( 'dependencies' => array( 'wp-blocks' ) );",
				written: false,
				loadsAfter: [ 'wp-blocks' ],
			},
		] )(
			'$name',
			async ( { script, asset, written, loadsAfter } ) => {
				const before = await blockScriptAssets.read( site.path, undefined, host );
				mkdirSync( path.join( dir, 'src' ), { recursive: true } );
				writeFileSync( path.join( dir, 'opening-hours.php' ), PLUGIN );
				writeFileSync( path.join( dir, 'block.json' ), BLOCK_JSON );
				writeFileSync( path.join( dir, 'src/index.js' ), script );
				if ( asset ) {
					writeFileSync( path.join( dir, 'src/index.asset.php' ), asset );
				}
				await runWpCli( host, site, [ 'plugin', 'activate', 'opening-hours' ] );
				const after = await blockScriptAssets.read( site.path, undefined, host );

				const { reports } = await blockScriptAssets.check( site, before, after, host );

				expect( reports ).toHaveLength( written ? 1 : 0 );
				// What WordPress prints up to the block's script: the packages it reads first, or the script alone.
				const [ printed, reload ] = ( await runWpCli( host, site, [ 'eval', LOADS ] ) ).split(
					'\n'
				);
				const loads = JSON.parse( printed ) as string[];
				expect( reload === 'edited script loads again' ).toBe( written );
				expect( loads.length > 1 ).toBe( loadsAfter.length > 0 );
				expect( loads ).toEqual( expect.arrayContaining( loadsAfter ) );
			},
			120000
		);
	}
);
