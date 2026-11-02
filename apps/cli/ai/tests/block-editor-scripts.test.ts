import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { blockEditorScripts } from '@studio/agent/node/block-editor-scripts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import type { HostSite, StudioAgentHost } from '@studio/agent/node';

// What the site's block editor registers, which needs the site served.
const editor = vi.hoisted( () => ( { registers: [] as string[] } ) );
vi.mock( '@studio/agent/node/block-validator', () => ( {
	unregisteredInEditor: async ( names: string[] ) =>
		names.filter( ( name ) => ! editor.registers.includes( name ) ),
} ) );
vi.mock( 'cli/lib/run-wp-cli-command', async ( importOriginal ) => ( {
	runWpCliCommand: vi.fn(
		( await importOriginal< typeof import('cli/lib/run-wp-cli-command') >() ).runWpCliCommand
	),
} ) );

// A real WordPress install to register blocks with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

const PLUGIN = `<?php
/**
 * Plugin Name: Opening hours
 */
add_action( 'init', function () { register_block_type( __DIR__ . '/build' ); } );
`;

const blockJson = ( fields: object ) =>
	JSON.stringify( {
		apiVersion: 3,
		name: 'bakehouse/opening-hours',
		title: 'Opening hours',
		render: 'file:./render.php',
		...fields,
	} );

describe.runIf( WORDPRESS )(
	'the blocks the site’s code registers without an editor script',
	() => {
		let site: HostSite;
		let host: StudioAgentHost;
		let dir: string;
		beforeEach( () => {
			const root = mkdtempSync( path.join( os.tmpdir(), 'block-editor-scripts-' ) );
			cpSync( WORDPRESS!, root, { recursive: true } );
			site = liveSite( root, 'Corner Bakehouse' );
			host = liveHost( site );
			dir = path.join( root, 'wp-content/plugins/opening-hours' );
		} );
		afterEach( () => {
			rmSync( site.path, { recursive: true, force: true } );
			editor.registers = [];
		} );

		const activate = async ( files: Record< string, string > ) => {
			for ( const [ file, content ] of Object.entries( {
				'opening-hours.php': PLUGIN,
				...files,
			} ) ) {
				mkdirSync( path.dirname( path.join( dir, file ) ), { recursive: true } );
				writeFileSync( path.join( dir, file ), content );
			}
			const { DatabaseSync } = await import( 'node:sqlite' );
			const db = new DatabaseSync( path.join( site.path, 'wp-content/database/.ht.sqlite' ) );
			db.prepare(
				"UPDATE wp_options SET option_value = ? WHERE option_name = 'active_plugins'"
			).run( 'a:1:{i:0;s:31:"opening-hours/opening-hours.php";}' );
			db.close();
		};

		it.each< {
			name: string;
			files: Record< string, string >;
			problem: boolean;
			editorRegisters?: string[];
		} >( [
			{
				// As the plugin of run 33's 01a176ac-8510 did, registering its script
				// on enqueue_block_editor_assets instead.
				name: 'a block.json without "editorScript"',
				files: {
					'build/block.json': blockJson( {} ),
					'src/block.json': blockJson( {} ),
					// A build's dependencies are not the site's code, whatever they name.
					'node_modules/some-package/block.json': blockJson( {} ),
				},
				problem: true,
			},
			{
				name: 'a block.json naming its script as a file',
				files: {
					'build/block.json': blockJson( { editorScript: 'file:./index.js' } ),
					'build/index.js': '',
					'build/index.asset.php':
						"<?php return array( 'dependencies' => array( 'wp-blocks' ), 'version' => '1' );",
				},
				problem: false,
			},
			{
				name: 'a block that renders on the server and has "autoRegister"',
				files: {
					'build/block.json': blockJson( { supports: { autoRegister: true } } ),
					'build/render.php': '<p>Open daily</p>',
				},
				problem: false,
			},
			{
				// As WooCommerce 11.2's cart and checkout inner blocks, which the
				// script of the block they sit in registers (run 55).
				name: 'a block.json without "editorScript" whose block another script registers',
				files: { 'build/block.json': blockJson( {} ) },
				problem: false,
				editorRegisters: [ 'bakehouse/opening-hours' ],
			},
			{
				// Dependencies a build installs are not the site's code.
				name: 'a block.json in node_modules',
				files: {
					'build/block.json': blockJson( { editorScript: 'file:./index.js' } ),
					'build/index.js': '',
					'node_modules/some-package/block.json': blockJson( { name: 'other/block' } ),
				},
				problem: false,
			},
		] )(
			'reports $name',
			async ( { files, problem, editorRegisters = [] } ) => {
				editor.registers = editorRegisters;
				const before = await blockEditorScripts.read( site.path, undefined, host );
				await activate( files );
				const after = await blockEditorScripts.read( site.path, undefined, host );
				const { reports } = await blockEditorScripts.check( site, before, after, host );
				expect( reports ).toHaveLength( 1 );
				if ( problem ) {
					expect( reports[ 0 ].problem ).toBe(
						`Corner Bakehouse: WordPress registers bakehouse/opening-hours (${ path.join(
							dir,
							'build/block.json'
						) }, ${ path.join(
							dir,
							'src/block.json'
						) }) with no editor script. register_block_type_from_metadata() (wp-includes/blocks.php) gives a block type the scripts its block.json "editorScript" names, and the block editor loads them for it (WP_Block_Type::$editor_script_handles). "editorScript" takes a handle the plugin registers before the block, or "file:./index.js", which register_block_script_handle() registers with the dependencies and version of the index.asset.php beside it, as @wordpress/scripts writes it. A block that renders on the server can instead have "supports": { "autoRegister": true }, and the editor registers it itself (_wp_enqueue_auto_register_blocks() in wp-includes/blocks.php).`
					);
				} else {
					expect( reports[ 0 ].problem ).toBeUndefined();
				}
			},
			120000
		);

		it( 'asks WordPress only when the active code changed', async () => {
			await activate( { 'build/block.json': blockJson( {} ) } );
			const versions = await blockEditorScripts.read( site.path, undefined, host );
			vi.mocked( runWpCliCommand ).mockClear();
			expect( await blockEditorScripts.check( site, versions, versions, host ) ).toEqual( {
				reports: [],
			} );
			// A build's dependencies are not the site's code.
			mkdirSync( path.join( dir, 'node_modules/pkg' ), { recursive: true } );
			writeFileSync( path.join( dir, 'node_modules/pkg/index.js' ), '' );
			expect( await blockEditorScripts.read( site.path, undefined, host ) ).toEqual( versions );
			// Nor is a stylesheet, which registers nothing.
			writeFileSync( path.join( dir, 'build/style.css' ), '' );
			expect( await blockEditorScripts.read( site.path, undefined, host ) ).toEqual( versions );
			// The block's own block.json is.
			writeFileSync( path.join( dir, 'build/block.json' ), blockJson( { editorScript: 'x' } ) );
			expect( await blockEditorScripts.read( site.path, undefined, host ) ).not.toEqual( versions );
			expect( runWpCliCommand ).not.toHaveBeenCalled();
		}, 120000 );
	}
);
