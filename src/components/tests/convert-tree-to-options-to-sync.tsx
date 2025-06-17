import { renderHook } from '@testing-library/react';
import { updateNodeById } from 'src/components/tree-view';
import { convertTreeToOptionsToSync } from '../sync-connected-sites';
import { useDefaultTree } from '../sync-dialog';

describe( 'convertTreeToOptionsToSync', () => {
	it( 'returns ["all"] when all options are selected', () => {
		const { result } = renderHook( () => useDefaultTree() );
		const tree = result.current;

		const optionsToSync = convertTreeToOptionsToSync( tree );
		expect( optionsToSync ).toEqual( [ 'all' ] );
	} );

	it( 'returns ["sqls"] when only database is selected', () => {
		const { result } = renderHook( () => useDefaultTree() );
		let tree = result.current;

		tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );

		const optionsToSync = convertTreeToOptionsToSync( tree );
		expect( optionsToSync ).toEqual( [ 'sqls' ] );
	} );

	it( 'returns ["plugins"] when only plugins are selected', () => {
		const { result } = renderHook( () => useDefaultTree() );
		let tree = result.current;

		tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );
		tree = updateNodeById( tree, 'sqls', { checked: false } );
		tree = updateNodeById( tree, 'plugins', { checked: true } );

		const optionsToSync = convertTreeToOptionsToSync( tree );
		expect( optionsToSync ).toEqual( [ 'plugins' ] );
	} );

	it( 'returns ["sqls", "plugins"] when both are selected', () => {
		const { result } = renderHook( () => useDefaultTree() );
		let tree = result.current;

		tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );
		tree = updateNodeById( tree, 'plugins', { checked: true } );

		const optionsToSync = convertTreeToOptionsToSync( tree );
		expect( optionsToSync ).toEqual( [ 'sqls', 'plugins' ] );
	} );
} );
