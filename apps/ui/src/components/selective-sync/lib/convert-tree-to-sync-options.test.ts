import { describe, expect, it } from 'vitest';
import { convertTreeToReprintPullOptions } from '@/components/selective-sync/lib/convert-tree-to-sync-options';
import type { TreeNode } from '@/components/selective-sync/tree-view';

/**
 * The cases below mirror `mapCheckedNodesToSelection`'s in
 * `apps/cli/lib/pull/reprint-selector.test.ts`. The two reductions feed the
 * same `--only` flag from different front ends, so they must not drift.
 */

/** A wp-content entry. Remote tree paths are always slash-terminated. */
function entry( relativePath: string, checked: boolean, children?: TreeNode[] ): TreeNode {
	return {
		id: relativePath,
		name: relativePath.split( '/' ).pop() ?? relativePath,
		label: relativePath,
		checked,
		indeterminate: ! checked && Boolean( children?.some( ( child ) => child.checked ) ),
		path: `/wp-content/${ relativePath }/`,
		pathId: `backup-id-${ relativePath }`,
		children,
	};
}

function tree( {
	database,
	wpContentChildren = [],
	allFiles = false,
}: {
	database: boolean;
	wpContentChildren?: TreeNode[];
	allFiles?: boolean;
} ): TreeNode[] {
	return [
		{ id: 'sqls', name: 'sqls', label: 'Database', checked: database },
		{
			id: 'filesAndFolders',
			name: 'filesAndFolders',
			label: 'Files',
			checked: allFiles,
			children: [
				{
					id: 'wp-content',
					name: 'wp-content',
					label: 'wp-content',
					checked: allFiles,
					children: wpContentChildren,
				},
			],
		},
	];
}

describe( 'convertTreeToReprintPullOptions', () => {
	it( 'maps a full selection to no --only and keeps the database', () => {
		expect( convertTreeToReprintPullOptions( tree( { database: true, allFiles: true } ) ) ).toEqual(
			{ onlyPaths: [], skipDatabase: false }
		);
	} );

	it( 'skips the database when it is unchecked', () => {
		expect(
			convertTreeToReprintPullOptions( tree( { database: false, allFiles: true } ) ).skipDatabase
		).toBe( true );
	} );

	it( 'maps selected directories to wp-content-relative paths', () => {
		expect(
			convertTreeToReprintPullOptions(
				tree( {
					database: true,
					wpContentChildren: [ entry( 'plugins', true ), entry( 'themes', true ) ],
				} )
			)
		).toEqual( { onlyPaths: [ 'plugins', 'themes' ], skipDatabase: false } );
	} );

	it( 'leaves out an unchecked sibling', () => {
		expect(
			convertTreeToReprintPullOptions(
				tree( {
					database: false,
					wpContentChildren: [ entry( 'plugins', true ), entry( 'themes', false ) ],
				} )
			)
		).toEqual( { onlyPaths: [ 'plugins' ], skipDatabase: true } );
	} );

	it( 'maps a selected file to its wp-content path', () => {
		expect(
			convertTreeToReprintPullOptions(
				tree( {
					database: false,
					wpContentChildren: [
						entry( 'uploads', false, [ entry( 'uploads/2026/banner.jpg', true ) ] ),
					],
				} )
			)
		).toEqual( { onlyPaths: [ 'uploads/2026/banner.jpg' ], skipDatabase: true } );
	} );

	it( 'collapses a fully-checked directory rather than listing its descendants', () => {
		expect(
			convertTreeToReprintPullOptions(
				tree( {
					database: false,
					wpContentChildren: [ entry( 'plugins', true, [ entry( 'plugins/akismet', true ) ] ) ],
				} )
			).onlyPaths
		).toEqual( [ 'plugins' ] );
	} );

	it( 'keeps a deep partial selection as its own path', () => {
		expect(
			convertTreeToReprintPullOptions(
				tree( {
					database: false,
					wpContentChildren: [ entry( 'plugins', false, [ entry( 'plugins/akismet', true ) ] ) ],
				} )
			).onlyPaths
		).toEqual( [ 'plugins/akismet' ] );
	} );

	it( 'returns no paths when only the database is checked', () => {
		expect( convertTreeToReprintPullOptions( tree( { database: true } ) ) ).toEqual( {
			onlyPaths: [],
			skipDatabase: false,
		} );
	} );

	it( 'treats a checked wp-content root as everything, whatever its children say', () => {
		expect(
			convertTreeToReprintPullOptions( [
				{ id: 'sqls', name: 'sqls', label: 'Database', checked: false },
				{
					id: 'filesAndFolders',
					name: 'filesAndFolders',
					label: 'Files',
					checked: false,
					children: [
						{
							id: 'wp-content',
							name: 'wp-content',
							label: 'wp-content',
							checked: true,
							children: [ entry( 'plugins', true ) ],
						},
					],
				},
			] )
		).toEqual( { onlyPaths: [], skipDatabase: true } );
	} );

	it( 'throws when the tree is missing the database or files branch', () => {
		expect( () => convertTreeToReprintPullOptions( [] ) ).toThrow(
			/Database or files and folders/
		);
	} );
} );
