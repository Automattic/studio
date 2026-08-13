import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLatestRewindId, fetchRemoteFileTree } from 'cli/lib/sync-api';
import treeCheckbox from 'cli/lib/tree-checkbox';
import {
	canonicalizeTreeValues,
	mapCheckedNodesToSelection,
	mapCliOnlyToReprint,
	resolveOnlyPathsToAbsolute,
	selectPullItems,
} from './reprint-selector';
import type { TreeNode } from 'cli/lib/tree-checkbox';

vi.mock( 'cli/lib/sync-api', () => ( {
	fetchLatestRewindId: vi.fn(),
	fetchRemoteFileTree: vi.fn(),
} ) );
vi.mock( 'cli/lib/tree-checkbox', () => ( { default: vi.fn() } ) );

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

	it( 'maps a single-file plugin to its own path and collapses it under a checked folder', () => {
		expect(
			mapCheckedNodesToSelection( [ checked( 'plugins/hello.php', 2 ) ] ).fileOnlyPaths
		).toEqual( [ ':wp-content:/plugins/hello.php' ] );

		expect(
			mapCheckedNodesToSelection( [ checked( 'plugins' ), checked( 'plugins/hello.php', 2 ) ] )
				.fileOnlyPaths
		).toEqual( [ ':wp-content:/plugins' ] );
	} );

	it( 'reports no files selected when only the database is checked', () => {
		expect( mapCheckedNodesToSelection( [ checked( 'database', 0 ) ] ).hasAnyFile ).toBe( false );
	} );
} );

describe( 'canonicalizeTreeValues', () => {
	it( 'strips trailing slashes from directories and keeps files in the tree', () => {
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
							checked( 'plugins/hello.php', 2 ),
						],
					},
				],
			},
		];

		const canonical = canonicalizeTreeValues( tree );

		expect( canonical.map( ( node ) => node.value ) ).toEqual( [ 'database', 'wp-content' ] );
		expect( canonical[ 1 ].children?.map( ( node ) => node.value ) ).toEqual( [ 'plugins' ] );
		expect( canonical[ 1 ].children?.[ 0 ].children?.map( ( node ) => node.value ) ).toEqual( [
			'plugins/akismet',
			'plugins/hello.php',
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

	it( 'maps a file path like any other wp-content path', () => {
		expect( mapCliOnlyToReprint( [ 'plugins/hello.php' ] ) ).toEqual( [
			':wp-content:/plugins/hello.php',
		] );
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

describe( 'selectPullItems expansion', () => {
	beforeEach( () => {
		vi.mocked( fetchLatestRewindId ).mockResolvedValue( 'rewind-1' );
		vi.mocked( fetchRemoteFileTree ).mockResolvedValue( [
			{ name: 'akismet', isDirectory: true, pathId: '1', path: '/wp-content/plugins/akismet/' },
			{ name: 'hello.php', isDirectory: false, pathId: '2', path: '/wp-content/plugins/hello.php' },
			{
				name: '*unchanged',
				isDirectory: false,
				pathId: '3',
				path: '/wp-content/plugins/*unchanged',
			},
		] );
	} );

	async function expandPlugins(): Promise< TreeNode[] > {
		let captured: Parameters< typeof treeCheckbox >[ 0 ] | undefined;
		vi.mocked( treeCheckbox ).mockImplementation( async ( options ) => {
			captured = options;
			return [];
		} );

		await selectPullItems( [], { token: 'token', remoteSiteId: 7 } );

		return ( await captured!.onExpand!( checked( 'plugins' ) ) ) ?? [];
	}

	it( 'requests the folder with a trailing slash so nested paths stay separated', async () => {
		await expandPlugins();

		expect( fetchRemoteFileTree ).toHaveBeenCalledWith(
			'token',
			7,
			'rewind-1',
			'/wp-content/plugins/'
		);
	} );

	it( 'lists the files inside the folder and drops the unchanged-archive placeholder', async () => {
		expect( ( await expandPlugins() ).map( ( node ) => node.value ) ).toEqual( [
			'plugins/akismet',
			'plugins/hello.php',
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
