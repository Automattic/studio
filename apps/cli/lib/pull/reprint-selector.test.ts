import { describe, expect, it, vi } from 'vitest';
import { fetchPullTree } from 'cli/lib/sync-selector';
import {
	fetchJetpackPullTree,
	mapCheckedNodesToSelection,
	mapCliOnlyToReprint,
} from './reprint-selector';
import type { TreeNode } from 'cli/lib/tree-checkbox';

vi.mock( 'cli/lib/sync-selector', () => ( {
	fetchPullTree: vi.fn(),
	buildTreeFromRemote: vi.fn(),
} ) );

/** Minimal checked node — mapCheckedNodesToSelection only reads `value`. */
function checked( value: string, depth = 1 ): TreeNode {
	return { name: value, value, isDirectory: false, checked: true, expanded: false, depth };
}

describe( 'fetchJetpackPullTree', () => {
	it( 'keeps file leaves from the remote tree', async () => {
		const tree = [ checked( 'database', 0 ), checked( 'uploads/banner.jpg', 2 ) ];
		vi.mocked( fetchPullTree ).mockResolvedValue( { tree, rewindId: 'rewind-1' } );

		expect( await fetchJetpackPullTree( 'token', 123 ) ).toEqual( tree );
	} );
} );

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

	it( 'maps a selected file to its wp-content path', () => {
		expect( mapCheckedNodesToSelection( [ checked( 'uploads/2026/banner.jpg', 3 ) ] ) ).toEqual( {
			fileOnlyPaths: [ ':wp-content:/uploads/2026/banner.jpg' ],
			skipDatabase: true,
			hasAnyFile: true,
		} );
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
