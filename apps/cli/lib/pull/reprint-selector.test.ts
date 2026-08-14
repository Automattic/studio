import { describe, expect, it } from 'vitest';
import {
	filterTreeToDirectories,
	mapCheckedNodesToSelection,
	mapCliOnlyToReprint,
	resolveOnlyPathsToAbsolute,
} from './reprint-selector';
import type { TreeNode } from 'cli/lib/tree-checkbox';

const CONTENT_DIR = '/srv/htdocs/wp-content';

/** Minimal checked node — mapCheckedNodesToSelection only reads `value`. */
function checked( value: string, depth = 1 ): TreeNode {
	return { name: value, value, isDirectory: false, checked: true, expanded: false, depth };
}

describe( 'mapCheckedNodesToSelection', () => {
	it( 'maps a full selection to no --only and keeps the database', () => {
		const selected = [ checked( 'database', 0 ), checked( 'wp-content', 0 ), checked( 'plugins' ) ];
		expect( mapCheckedNodesToSelection( selected ) ).toEqual( {
			fileOnlyPaths: [],
			skipDatabase: false,
			hasAnyFile: true,
		} );
	} );

	it( 'flags --no-db when the database is unchecked', () => {
		const selected = [ checked( 'wp-content', 0 ), checked( 'plugins' ) ];
		expect( mapCheckedNodesToSelection( selected ).skipDatabase ).toBe( true );
	} );

	it( 'maps selected directories to wp-content paths', () => {
		const selected = [ checked( 'database', 0 ), checked( 'plugins' ), checked( 'themes' ) ];
		expect( mapCheckedNodesToSelection( selected ).fileOnlyPaths ).toEqual( [
			':wp-content:/plugins',
			':wp-content:/themes',
		] );
	} );

	it( 'collapses a fully-checked directory and keeps a deep partial selection as a path', () => {
		expect(
			mapCheckedNodesToSelection( [ checked( 'plugins' ), checked( 'plugins/akismet', 2 ) ] )
				.fileOnlyPaths
		).toEqual( [ ':wp-content:/plugins' ] );

		expect(
			mapCheckedNodesToSelection( [ checked( 'plugins/akismet', 2 ) ] ).fileOnlyPaths
		).toEqual( [ ':wp-content:/plugins/akismet' ] );
	} );

	it( 'reports no files selected when only the database is checked', () => {
		expect( mapCheckedNodesToSelection( [ checked( 'database', 0 ) ] ).hasAnyFile ).toBe( false );
	} );
} );

describe( 'filterTreeToDirectories', () => {
	it( 'keeps the database toggle and canonical directory hierarchy while dropping files', () => {
		const tree: TreeNode[] = [
			checked( 'database', 0 ),
			{
				name: 'wp-content/',
				value: 'wp-content',
				isDirectory: true,
				checked: true,
				expanded: true,
				depth: 0,
				children: [
					checked( 'plugins/f26d-error.php', 2 ),
					{
						name: 'plugins/',
						value: 'plugins/',
						isDirectory: true,
						checked: true,
						expanded: false,
						depth: 1,
						children: [
							{
								name: 'akismet/',
								value: 'plugins/akismet/',
								isDirectory: true,
								checked: true,
								expanded: false,
								depth: 2,
							},
						],
					},
				],
			},
		];

		const filtered = filterTreeToDirectories( tree );

		expect( filtered.map( ( node ) => node.value ) ).toEqual( [ 'database', 'wp-content' ] );
		expect( filtered[ 1 ].children?.map( ( node ) => node.value ) ).toEqual( [ 'plugins' ] );
		expect( filtered[ 1 ].children?.[ 0 ].children?.map( ( node ) => node.value ) ).toEqual( [
			'plugins/akismet',
		] );
	} );
} );

describe( 'mapCliOnlyToReprint', () => {
	it( 'maps wp-content-relative paths to the wp-content token', () => {
		expect( mapCliOnlyToReprint( [ 'plugins', 'plugins/akismet', 'themes', 'uploads' ] ) ).toEqual(
			[
				':wp-content:/plugins',
				':wp-content:/plugins/akismet',
				':wp-content:/themes',
				':wp-content:/uploads',
			]
		);
	} );

	it( 'strips a leading wp-content/ and trailing slashes', () => {
		expect( mapCliOnlyToReprint( [ 'wp-content/plugins/akismet/' ] ) ).toEqual( [
			':wp-content:/plugins/akismet',
		] );
	} );

	it( 'passes through reprint tokens and absolute paths unchanged', () => {
		expect( mapCliOnlyToReprint( [ ':wp-uploads:', '/wordpress/plugins/akismet' ] ) ).toEqual( [
			':wp-uploads:',
			'/wordpress/plugins/akismet',
		] );
	} );
} );

describe( 'resolveOnlyPathsToAbsolute', () => {
	it( 'resolves wp-content tokens to content-dir paths', () => {
		expect(
			resolveOnlyPathsToAbsolute(
				[ ':wp-content:/plugins', ':wp-content:/uploads/2026', ':wp-plugins:', '/wordpress/core' ],
				CONTENT_DIR
			)
		).toEqual( [
			`${ CONTENT_DIR }/plugins`,
			`${ CONTENT_DIR }/uploads/2026`,
			`${ CONTENT_DIR }/plugins`,
			'/wordpress/core',
		] );
	} );
} );
