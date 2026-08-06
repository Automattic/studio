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
		expect( mapCheckedNodesToSelection( selected, CONTENT_DIR ) ).toEqual( {
			fileOnlyPaths: [],
			skipDatabase: false,
			skipUploads: false,
			hasAnyFile: true,
		} );
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

describe( 'filterTreeToDirectories', () => {
	it( 'keeps the database toggle and directory hierarchy while dropping files', () => {
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
						value: 'plugins',
						isDirectory: true,
						checked: true,
						expanded: false,
						depth: 1,
					},
				],
			},
		];

		const filtered = filterTreeToDirectories( tree );

		expect( filtered.map( ( node ) => node.value ) ).toEqual( [ 'database', 'wp-content' ] );
		expect( filtered[ 1 ].children?.map( ( node ) => node.value ) ).toEqual( [ 'plugins' ] );
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
