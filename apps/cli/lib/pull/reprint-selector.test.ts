import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	buildReprintTreeFromIndex,
	mapCheckedNodesToSelection,
	mapCliOnlyToReprint,
	resolveOnlyPathsToAbsolute,
} from './reprint-selector';
import type { TreeNode } from 'cli/lib/tree-checkbox';

const CONTENT_DIR = '/srv/htdocs/wp-content';

function encodeEntry(
	absolutePath: string,
	type: 'file' | 'dir' | 'link' = 'file',
	target?: string
): string {
	return JSON.stringify( {
		path: Buffer.from( absolutePath, 'utf-8' ).toString( 'base64' ),
		size: 0,
		ctime: 0,
		type,
		...( target ? { target: Buffer.from( target, 'utf-8' ).toString( 'base64' ) } : {} ),
	} );
}

/** Minimal checked node — mapCheckedNodesToSelection only reads `value`. */
function checked( value: string, depth = 1 ): TreeNode {
	return { name: value, value, isDirectory: false, checked: true, expanded: false, depth };
}

describe( 'buildReprintTreeFromIndex', () => {
	let dir: string;
	let indexPath: string;

	beforeEach( () => {
		dir = fs.mkdtempSync( path.join( os.tmpdir(), 'reprint-selector-' ) );
		indexPath = path.join( dir, '.import-remote-index.jsonl' );
	} );

	afterEach( () => {
		fs.rmSync( dir, { recursive: true, force: true } );
	} );

	it( 'builds a directories-only Database + wp-content tree, pruning files', async () => {
		fs.writeFileSync(
			indexPath,
			[
				encodeEntry( `${ CONTENT_DIR }/plugins/akismet/akismet.php` ),
				encodeEntry( `${ CONTENT_DIR }/plugins/hello.php` ), // single-file plugin → pruned
				encodeEntry( `${ CONTENT_DIR }/themes/twentytwentyfour`, 'dir' ),
				encodeEntry( `${ CONTENT_DIR }/index.php` ), // drop-in file → pruned
				encodeEntry( '/wordpress/core/wp-load.php' ), // outside wp-content → ignored
			].join( '\n' )
		);

		const { tree } = await buildReprintTreeFromIndex( indexPath, CONTENT_DIR );

		expect( tree ).toHaveLength( 2 );
		expect( tree[ 0 ] ).toMatchObject( { value: 'database', depth: 0 } );
		expect( tree[ 1 ] ).toMatchObject( { value: 'wp-content', isDirectory: true, depth: 0 } );

		const topLevel = tree[ 1 ].children ?? [];
		expect( topLevel.map( ( n ) => n.value ) ).toEqual( [ 'plugins', 'themes' ] );

		const plugins = topLevel.find( ( n ) => n.value === 'plugins' )!;
		// akismet (real dir) kept; hello.php (file) pruned.
		expect( ( plugins.children ?? [] ).map( ( n ) => n.value ) ).toEqual( [ 'plugins/akismet' ] );
		expect( plugins.children![ 0 ].children ?? [] ).toEqual( [] ); // akismet.php pruned
	} );

	it( 'keeps symlinks that point at directories and prunes symlinks that point at files', async () => {
		fs.writeFileSync(
			indexPath,
			[
				encodeEntry(
					`${ CONTENT_DIR }/plugins/jetpack`,
					'link',
					'/wordpress/plugins/jetpack/16.0'
				),
				encodeEntry( '/wordpress/plugins/jetpack/16.0/jetpack.php' ),
				encodeEntry( `${ CONTENT_DIR }/advanced-cache.php`, 'link' ), // drop-in → pruned
			].join( '\n' )
		);

		const { tree, linkTargets } = await buildReprintTreeFromIndex( indexPath, CONTENT_DIR );
		const topLevel = tree[ 1 ].children ?? [];
		expect( topLevel.map( ( n ) => n.value ) ).toEqual( [ 'plugins' ] );
		expect( linkTargets ).toEqual( { 'plugins/jetpack': '/wordpress/plugins/jetpack/16.0' } );
		expect( ( topLevel[ 0 ].children ?? [] ).map( ( n ) => n.value ) ).toEqual( [
			'plugins/jetpack',
		] );
		expect( topLevel[ 0 ].children![ 0 ].isDirectory ).toBe( true );
	} );

	it( 'caps plugins/themes/mu-plugins at the add-on level, keeping uploads subdirs', async () => {
		fs.writeFileSync(
			indexPath,
			[
				// A plugin with nested internals — must stop at plugins/woocommerce.
				encodeEntry( `${ CONTENT_DIR }/plugins/woocommerce/includes/class-wc.php` ),
				encodeEntry( `${ CONTENT_DIR }/plugins/woocommerce/assets/js/app.js` ),
				// A theme with internals — must stop at themes/storefront.
				encodeEntry( `${ CONTENT_DIR }/themes/storefront/inc/setup.php` ),
				// A mu-plugin with internals — must stop at mu-plugins/wpcomsh.
				encodeEntry( `${ CONTENT_DIR }/mu-plugins/wpcomsh/lib/load.php` ),
				// uploads is NOT capped — its date subdirs stay as directories.
				encodeEntry( `${ CONTENT_DIR }/uploads/2026/07/photo.jpg` ),
			].join( '\n' )
		);

		const { tree } = await buildReprintTreeFromIndex( indexPath, CONTENT_DIR );
		const byValue = ( nodes: TreeNode[] = [] ) =>
			Object.fromEntries( nodes.map( ( n ) => [ n.value, n ] ) );

		const top = byValue( tree[ 1 ].children );
		expect( Object.keys( top ).sort() ).toEqual( [ 'mu-plugins', 'plugins', 'themes', 'uploads' ] );

		// plugins/woocommerce is a leaf — its includes/assets are not expanded.
		const woo = byValue( top.plugins.children )[ 'plugins/woocommerce' ];
		expect( woo.children ?? [] ).toEqual( [] );
		// same for the theme and mu-plugin.
		expect( byValue( top.themes.children )[ 'themes/storefront' ].children ?? [] ).toEqual( [] );
		expect(
			byValue( top[ 'mu-plugins' ].children )[ 'mu-plugins/wpcomsh' ].children ?? []
		).toEqual( [] );
		// uploads keeps its (directory) subtree.
		expect( byValue( top.uploads.children )[ 'uploads/2026' ] ).toBeDefined();
	} );

	it( 'returns an empty tree when the content dir is unknown or nothing is under it', async () => {
		fs.writeFileSync( indexPath, encodeEntry( '/srv/htdocs/index.php' ) );
		expect( ( await buildReprintTreeFromIndex( indexPath, null ) ).tree ).toEqual( [] );
		expect( ( await buildReprintTreeFromIndex( indexPath, CONTENT_DIR ) ).tree ).toEqual( [] );
	} );
} );

describe( 'mapCheckedNodesToSelection', () => {
	it( 'maps a full selection to no --only and keeps the database', () => {
		const selected = [ checked( 'database', 0 ), checked( 'wp-content', 0 ), checked( 'plugins' ) ];
		expect( mapCheckedNodesToSelection( selected, CONTENT_DIR ) ).toEqual( {
			fileOnlyPaths: [],
			skipDatabase: false,
			skipUploads: false,
			hasAnyFile: true,
			symlinkPaths: [],
		} );
	} );

	it( 'records selected entries that are symlinks on the remote', () => {
		const linkTargets = { 'plugins/jetpack': '/wordpress/plugins/jetpack/16.0' };
		const selection = mapCheckedNodesToSelection(
			[ checked( 'plugins/jetpack', 2 ), checked( 'themes' ) ],
			CONTENT_DIR,
			linkTargets
		);
		expect( selection.symlinkPaths ).toEqual( [
			{ path: `${ CONTENT_DIR }/plugins/jetpack`, target: '/wordpress/plugins/jetpack/16.0' },
		] );

		// A link inside a fully-selected parent needs no restoration: the
		// scoped listing of the parent includes it as a child.
		expect(
			mapCheckedNodesToSelection( [ checked( 'plugins' ) ], CONTENT_DIR, linkTargets ).symlinkPaths
		).toEqual( [] );
	} );

	it( 'skips the media library unless uploads (or everything) is selected', () => {
		expect( mapCheckedNodesToSelection( [ checked( 'plugins' ) ], CONTENT_DIR ).skipUploads ).toBe(
			true
		);
		expect( mapCheckedNodesToSelection( [ checked( 'uploads' ) ], CONTENT_DIR ).skipUploads ).toBe(
			false
		);
		expect(
			mapCheckedNodesToSelection( [ checked( 'uploads/2026', 2 ) ], CONTENT_DIR ).skipUploads
		).toBe( false );
	} );

	it( 'flags --no-db when the database is unchecked', () => {
		const selected = [ checked( 'wp-content', 0 ), checked( 'plugins' ) ];
		expect( mapCheckedNodesToSelection( selected, CONTENT_DIR ).skipDatabase ).toBe( true );
	} );

	it( 'maps top-level areas to reprint tokens or absolute paths', () => {
		const selected = [ checked( 'database', 0 ), checked( 'plugins' ), checked( 'themes' ) ];
		expect( mapCheckedNodesToSelection( selected, CONTENT_DIR ).fileOnlyPaths ).toEqual( [
			':wp-plugins:',
			`${ CONTENT_DIR }/themes`,
		] );
	} );

	it( 'collapses a fully-checked directory and keeps a deep partial selection as a path', () => {
		expect(
			mapCheckedNodesToSelection(
				[ checked( 'plugins' ), checked( 'plugins/akismet', 2 ) ],
				CONTENT_DIR
			).fileOnlyPaths
		).toEqual( [ ':wp-plugins:' ] );

		expect(
			mapCheckedNodesToSelection( [ checked( 'plugins/akismet', 2 ) ], CONTENT_DIR ).fileOnlyPaths
		).toEqual( [ `${ CONTENT_DIR }/plugins/akismet` ] );
	} );

	it( 'reports no files selected when only the database is checked', () => {
		expect(
			mapCheckedNodesToSelection( [ checked( 'database', 0 ) ], CONTENT_DIR ).hasAnyFile
		).toBe( false );
	} );
} );

describe( 'mapCliOnlyToReprint', () => {
	it( 'maps wp-content-relative paths to tokens or absolute paths', () => {
		expect(
			mapCliOnlyToReprint( [ 'plugins', 'plugins/akismet', 'themes', 'uploads' ], CONTENT_DIR )
		).toEqual( [
			':wp-plugins:',
			`${ CONTENT_DIR }/plugins/akismet`,
			`${ CONTENT_DIR }/themes`,
			':wp-uploads:',
		] );
	} );

	it( 'strips a leading wp-content/ and trailing slashes', () => {
		expect( mapCliOnlyToReprint( [ 'wp-content/plugins/akismet/' ], CONTENT_DIR ) ).toEqual( [
			`${ CONTENT_DIR }/plugins/akismet`,
		] );
	} );

	it( 'passes through reprint tokens and absolute paths unchanged', () => {
		expect(
			mapCliOnlyToReprint( [ ':wp-uploads:', '/wordpress/plugins/akismet' ], CONTENT_DIR )
		).toEqual( [ ':wp-uploads:', '/wordpress/plugins/akismet' ] );
	} );
} );

describe( 'resolveOnlyPathsToAbsolute', () => {
	it( 'resolves tokens to their conventional content-dir locations', () => {
		expect(
			resolveOnlyPathsToAbsolute(
				[ ':wp-plugins:', ':wp-uploads:/2026', `${ CONTENT_DIR }/themes`, '/wordpress/core' ],
				CONTENT_DIR
			)
		).toEqual( [
			`${ CONTENT_DIR }/plugins`,
			`${ CONTENT_DIR }/uploads/2026`,
			`${ CONTENT_DIR }/themes`,
			'/wordpress/core',
		] );
	} );
} );
