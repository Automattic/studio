// @vitest-environment node
// esbuild's TextEncoder/Uint8Array invariant fails under jsdom's remapped
// globals; this compile test is pure Node (fs + esbuild) and needs no DOM.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetPhp, compileBlock, wpGlobalForImport } from 'cli/ai/tools/site-generator/build-block';

describe( 'wpGlobalForImport', () => {
	it( 'maps @wordpress packages to their wp.* global and script handle', () => {
		expect( wpGlobalForImport( '@wordpress/blocks' ) ).toEqual( {
			global: 'window.wp.blocks',
			handle: 'wp-blocks',
		} );
		expect( wpGlobalForImport( '@wordpress/block-editor' ) ).toEqual( {
			global: 'window.wp.blockEditor',
			handle: 'wp-block-editor',
		} );
		expect( wpGlobalForImport( '@wordpress/api-fetch' ) ).toEqual( {
			global: 'window.wp.apiFetch',
			handle: 'wp-api-fetch',
		} );
	} );

	it( 'maps the react jsx runtime to the WordPress global', () => {
		expect( wpGlobalForImport( 'react/jsx-runtime' ) ).toEqual( {
			global: 'window.ReactJSXRuntime',
			handle: 'react-jsx-runtime',
		} );
	} );

	it( 'returns null for relative or unknown imports (left for esbuild to bundle)', () => {
		expect( wpGlobalForImport( './edit' ) ).toBeNull();
		expect( wpGlobalForImport( 'some-lib' ) ).toBeNull();
	} );
} );

describe( 'assetPhp', () => {
	it( 'emits the WordPress asset dependency array, deduped and sorted', () => {
		const php = assetPhp( [ 'wp-blocks', 'react-jsx-runtime', 'wp-blocks' ], 'abc123' );
		expect( php.startsWith( '<?php return array(' ) ).toBe( true );
		expect( php ).toContain( "'dependencies' => array( 'react-jsx-runtime', 'wp-blocks' )" );
		expect( php ).toContain( "'version' => 'abc123'" );
		expect( ( php.match( /'wp-blocks'/g ) ?? [] ).length ).toBe( 1 );
	} );
} );

describe( 'compileBlock', () => {
	let tmp: string;

	beforeAll( () => {
		tmp = fs.mkdtempSync( path.join( os.tmpdir(), 'wsg-block-' ) );
		const src = path.join( tmp, 'src' );
		fs.mkdirSync( src, { recursive: true } );
		fs.writeFileSync(
			path.join( src, 'block.json' ),
			JSON.stringify( {
				apiVersion: 3,
				name: 'ember/reservation-form',
				title: 'Reservation Form',
				editorScript: 'file:./index.js',
				render: 'file:./render.php',
			} )
		);
		fs.writeFileSync( path.join( src, 'render.php' ), '<?php echo "form";' );
		fs.writeFileSync(
			path.join( src, 'edit.js' ),
			"import { useBlockProps } from '@wordpress/block-editor';\n" +
				"import { TextControl } from '@wordpress/components';\n" +
				'export default function Edit() {\n' +
				'\treturn <div { ...useBlockProps() }><TextControl label="Name" /></div>;\n' +
				'}\n'
		);
		fs.writeFileSync(
			path.join( src, 'index.js' ),
			"import { registerBlockType } from '@wordpress/blocks';\n" +
				"import Edit from './edit';\n" +
				"registerBlockType( 'ember/reservation-form', { edit: Edit, save: () => null } );\n"
		);
	} );

	afterAll( () => {
		fs.rmSync( tmp, { recursive: true, force: true } );
	} );

	it( 'bundles a JSX block to build/ with externalized WP deps + asset.php', async () => {
		const out = path.join( tmp, 'build' );
		const result = await compileBlock( path.join( tmp, 'src' ), out );

		const js = fs.readFileSync( path.join( out, 'index.js' ), 'utf8' );
		// WP packages resolve to runtime globals, not bundled copies.
		expect( js ).toContain( 'window.wp.blocks' );
		expect( js ).toContain( 'window.wp.blockEditor' );
		expect( js ).toContain( 'window.wp.components' );
		expect( js ).not.toContain( '@wordpress/blocks' );

		const asset = fs.readFileSync( path.join( out, 'index.asset.php' ), 'utf8' );
		expect( asset ).toContain( 'wp-blocks' );
		expect( asset ).toContain( 'wp-block-editor' );
		expect( asset ).toContain( 'wp-components' );
		expect( asset ).toContain( 'react-jsx-runtime' );

		expect( result.editorHandles ).toContain( 'wp-blocks' );
		expect( fs.existsSync( path.join( out, 'block.json' ) ) ).toBe( true );
		expect( fs.existsSync( path.join( out, 'render.php' ) ) ).toBe( true );
	} );
} );
