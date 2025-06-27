import { renderHook } from '@testing-library/react';
import { updateNodeById } from 'src/components/tree-view';
import { useDefaultSyncTree } from 'src/modules/sync-site/sync-dialog/use-default-sync-tree';
import { convertTreeToOptionsToSync } from '../sync-connected-sites';

describe( 'convertTreeToOptionsToSync', () => {
	it( 'returns ["all"] when all options are selected', () => {
		const { result } = renderHook( () => useDefaultSyncTree() );
		const tree = result.current;

		const optionsToSync = convertTreeToOptionsToSync( tree );
		expect( optionsToSync ).toEqual( { optionsToSync: [ 'all' ], specificSelections: undefined } );
	} );

	it( 'returns ["sqls"] when only database is selected', () => {
		const { result } = renderHook( () => useDefaultSyncTree() );
		let tree = result.current;

		tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );

		const optionsToSync = convertTreeToOptionsToSync( tree );
		expect( optionsToSync ).toEqual( { optionsToSync: [ 'sqls' ], specificSelections: undefined } );
	} );

	it( 'returns ["plugins"] when only plugins are selected', () => {
		const { result } = renderHook( () => useDefaultSyncTree() );
		let tree = result.current;

		tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );
		tree = updateNodeById( tree, 'sqls', { checked: false } );
		tree = updateNodeById( tree, 'plugins', { checked: true } );

		const optionsToSync = convertTreeToOptionsToSync( tree );
		expect( optionsToSync ).toEqual( {
			optionsToSync: [ 'plugins' ],
			specificSelections: undefined,
		} );
	} );

	it( 'returns ["sqls", "plugins"] when both are selected', () => {
		const { result } = renderHook( () => useDefaultSyncTree() );
		let tree = result.current;

		tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );
		tree = updateNodeById( tree, 'plugins', { checked: true } );

		const optionsToSync = convertTreeToOptionsToSync( tree );
		expect( optionsToSync ).toEqual( {
			optionsToSync: [ 'sqls', 'plugins' ],
			specificSelections: undefined,
		} );
	} );
} );
