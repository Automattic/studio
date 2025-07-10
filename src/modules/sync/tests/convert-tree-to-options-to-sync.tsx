import { renderHook } from '@testing-library/react';
import { updateNodeById } from 'src/components/tree-view';
import { useDefaultSyncTree } from 'src/modules/sync/hooks/use-default-sync-tree';
import { convertTreeToOptionsToSync } from 'src/modules/sync/lib/convert-tree-to-options-to-sync';

describe( 'convertTreeToOptionsToSync', () => {
	it( 'returns ["all"] when all options are selected', () => {
		const { result } = renderHook( () => useDefaultSyncTree( 'push' ) );
		const tree = result.current;

		const optionsToSync = convertTreeToOptionsToSync( tree );
		expect( optionsToSync ).toEqual( { optionsToSync: [ 'all' ], specificSelections: undefined } );
	} );

	it( 'returns ["sqls"] when only database is selected', () => {
		const { result } = renderHook( () => useDefaultSyncTree( 'push' ) );
		let tree = result.current;

		tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );

		const optionsToSync = convertTreeToOptionsToSync( tree );
		expect( optionsToSync ).toEqual( { optionsToSync: [ 'sqls' ], specificSelections: undefined } );
	} );

	it( 'returns ["plugins"] when only plugins are selected', () => {
		const { result } = renderHook( () => useDefaultSyncTree( 'push' ) );
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

	it( 'returns ["uploads"] when only uploads are selected', () => {
		const { result } = renderHook( () => useDefaultSyncTree( 'push' ) );
		let tree = result.current;

		tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );
		tree = updateNodeById( tree, 'sqls', { checked: false } );
		tree = updateNodeById( tree, 'uploads', { checked: true } );

		const optionsToSync = convertTreeToOptionsToSync( tree );
		expect( optionsToSync ).toEqual( {
			optionsToSync: [ 'uploads' ],
			specificSelections: undefined,
		} );
	} );

	it( 'returns ["sqls", "plugins"] when both are selected', () => {
		const { result } = renderHook( () => useDefaultSyncTree( 'push' ) );
		let tree = result.current;

		tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );
		tree = updateNodeById( tree, 'plugins', { checked: true } );

		const optionsToSync = convertTreeToOptionsToSync( tree );
		expect( optionsToSync ).toEqual( {
			optionsToSync: [ 'sqls', 'plugins' ],
			specificSelections: undefined,
		} );
	} );

	describe( 'partial selections', () => {
		it( 'returns partial plugins selection when only some plugins are selected', () => {
			const { result } = renderHook( () => useDefaultSyncTree( 'push' ) );
			let tree = result.current;

			tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );
			tree = updateNodeById( tree, 'sqls', { checked: false } );
			tree = updateNodeById( tree, 'themes', { checked: false } );
			tree = updateNodeById( tree, 'uploads', { checked: false } );
			tree = updateNodeById( tree, 'contents', { checked: false } );

			const wpContentNode = tree
				.find( ( node ) => node.id === 'filesAndFolders' )
				?.children?.find( ( node ) => node.id === 'wp-content' );
			if ( wpContentNode?.children ) {
				const pluginsNode = wpContentNode.children.find( ( node ) => node.id === 'plugins' );
				if ( pluginsNode ) {
					pluginsNode.checked = false;
					pluginsNode.indeterminate = true;
					pluginsNode.children = [
						{ id: 'plugin1', name: 'plugin1', label: 'Plugin 1', checked: true, type: 'folder' },
						{ id: 'plugin2', name: 'plugin2', label: 'Plugin 2', checked: false, type: 'folder' },
						{ id: 'plugin3', name: 'plugin3', label: 'Plugin 3', checked: true, type: 'folder' },
					];
				}
			}

			const optionsToSync = convertTreeToOptionsToSync( tree );
			expect( optionsToSync ).toEqual( {
				optionsToSync: [ 'plugins' ],
				specificSelections: {
					plugins: [ 'plugin1', 'plugin3' ],
				},
			} );
		} );

		it( 'returns partial themes selection when only some themes are selected', () => {
			const { result } = renderHook( () => useDefaultSyncTree( 'push' ) );
			let tree = result.current;

			tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );
			tree = updateNodeById( tree, 'sqls', { checked: false } );
			tree = updateNodeById( tree, 'plugins', { checked: false } );
			tree = updateNodeById( tree, 'uploads', { checked: false } );
			tree = updateNodeById( tree, 'contents', { checked: false } );

			const wpContentNode = tree
				.find( ( node ) => node.id === 'filesAndFolders' )
				?.children?.find( ( node ) => node.id === 'wp-content' );
			if ( wpContentNode?.children ) {
				const themesNode = wpContentNode.children.find( ( node ) => node.id === 'themes' );
				if ( themesNode ) {
					themesNode.checked = false;
					themesNode.indeterminate = true;
					themesNode.children = [
						{ id: 'theme1', name: 'theme1', label: 'Theme 1', checked: true, type: 'folder' },
						{ id: 'theme2', name: 'theme2', label: 'Theme 2', checked: false, type: 'folder' },
						{ id: 'theme3', name: 'theme3', label: 'Theme 3', checked: true, type: 'folder' },
						{ id: 'theme4', name: 'theme4', label: 'Theme 4', checked: false, type: 'folder' },
					];
				}
			}

			const optionsToSync = convertTreeToOptionsToSync( tree );
			expect( optionsToSync ).toEqual( {
				optionsToSync: [ 'themes' ],
				specificSelections: {
					themes: [ 'theme1', 'theme3' ],
				},
			} );
		} );

		it( 'returns partial uploads selection when only some uploads are selected', () => {
			const { result } = renderHook( () => useDefaultSyncTree( 'push' ) );
			let tree = result.current;

			tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );
			tree = updateNodeById( tree, 'sqls', { checked: false } );
			tree = updateNodeById( tree, 'plugins', { checked: false } );
			tree = updateNodeById( tree, 'themes', { checked: false } );
			tree = updateNodeById( tree, 'contents', { checked: false } );

			const wpContentNode = tree
				.find( ( node ) => node.id === 'filesAndFolders' )
				?.children?.find( ( node ) => node.id === 'wp-content' );
			if ( wpContentNode?.children ) {
				const uploadsNode = wpContentNode.children.find( ( node ) => node.id === 'uploads' );
				if ( uploadsNode ) {
					uploadsNode.checked = false;
					uploadsNode.indeterminate = true;
					uploadsNode.children = [
						{ id: 'upload1', name: 'upload1', label: 'Upload 1', checked: true, type: 'folder' },
						{ id: 'upload2', name: 'upload2', label: 'Upload 2', checked: true, type: 'folder' },
						{ id: 'upload3', name: 'upload3', label: 'Upload 3', checked: false, type: 'folder' },
					];
				}
			}

			const optionsToSync = convertTreeToOptionsToSync( tree );
			expect( optionsToSync ).toEqual( {
				optionsToSync: [ 'uploads' ],
				specificSelections: {
					uploads: [ 'upload1', 'upload2' ],
				},
			} );
		} );

		it( 'returns mixed partial selections for plugins and themes', () => {
			const { result } = renderHook( () => useDefaultSyncTree( 'push' ) );
			let tree = result.current;

			tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );
			tree = updateNodeById( tree, 'sqls', { checked: false } );
			tree = updateNodeById( tree, 'uploads', { checked: false } );
			tree = updateNodeById( tree, 'contents', { checked: false } );

			const wpContentNode = tree
				.find( ( node ) => node.id === 'filesAndFolders' )
				?.children?.find( ( node ) => node.id === 'wp-content' );
			if ( wpContentNode?.children ) {
				const pluginsNode = wpContentNode.children.find( ( node ) => node.id === 'plugins' );
				if ( pluginsNode ) {
					pluginsNode.checked = false;
					pluginsNode.indeterminate = true;
					pluginsNode.children = [
						{ id: 'plugin1', name: 'plugin1', label: 'Plugin 1', checked: true, type: 'folder' },
						{ id: 'plugin2', name: 'plugin2', label: 'Plugin 2', checked: false, type: 'folder' },
					];
				}

				const themesNode = wpContentNode.children.find( ( node ) => node.id === 'themes' );
				if ( themesNode ) {
					themesNode.checked = false;
					themesNode.indeterminate = true;
					themesNode.children = [
						{ id: 'theme1', name: 'theme1', label: 'Theme 1', checked: true, type: 'folder' },
						{ id: 'theme2', name: 'theme2', label: 'Theme 2', checked: false, type: 'folder' },
						{ id: 'theme3', name: 'theme3', label: 'Theme 3', checked: true, type: 'folder' },
					];
				}
			}

			const optionsToSync = convertTreeToOptionsToSync( tree );
			expect( optionsToSync ).toEqual( {
				optionsToSync: [ 'plugins', 'themes' ],
				specificSelections: {
					plugins: [ 'plugin1' ],
					themes: [ 'theme1', 'theme3' ],
				},
			} );
		} );

		it( 'returns no specificSelections when all children are selected in a category', () => {
			const { result } = renderHook( () => useDefaultSyncTree( 'push' ) );
			let tree = result.current;

			tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );
			tree = updateNodeById( tree, 'sqls', { checked: false } );
			tree = updateNodeById( tree, 'themes', { checked: false } );
			tree = updateNodeById( tree, 'uploads', { checked: false } );
			tree = updateNodeById( tree, 'contents', { checked: false } );

			const wpContentNode = tree
				.find( ( node ) => node.id === 'filesAndFolders' )
				?.children?.find( ( node ) => node.id === 'wp-content' );
			if ( wpContentNode?.children ) {
				const pluginsNode = wpContentNode.children.find( ( node ) => node.id === 'plugins' );
				if ( pluginsNode ) {
					pluginsNode.checked = true;
					pluginsNode.children = [
						{ id: 'plugin1', name: 'plugin1', label: 'Plugin 1', checked: true, type: 'folder' },
						{ id: 'plugin2', name: 'plugin2', label: 'Plugin 2', checked: true, type: 'folder' },
					];
				}
			}

			const optionsToSync = convertTreeToOptionsToSync( tree );
			expect( optionsToSync ).toEqual( {
				optionsToSync: [ 'plugins' ],
				specificSelections: undefined,
			} );
		} );

		it( 'returns no specificSelections when no children are selected in a category', () => {
			const { result } = renderHook( () => useDefaultSyncTree( 'push' ) );
			let tree = result.current;

			tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );
			tree = updateNodeById( tree, 'sqls', { checked: false } );
			tree = updateNodeById( tree, 'themes', { checked: false } );
			tree = updateNodeById( tree, 'uploads', { checked: false } );
			tree = updateNodeById( tree, 'contents', { checked: false } );

			const wpContentNode = tree
				.find( ( node ) => node.id === 'filesAndFolders' )
				?.children?.find( ( node ) => node.id === 'wp-content' );
			if ( wpContentNode?.children ) {
				const pluginsNode = wpContentNode.children.find( ( node ) => node.id === 'plugins' );
				if ( pluginsNode ) {
					pluginsNode.checked = false;
					pluginsNode.children = [
						{ id: 'plugin1', name: 'plugin1', label: 'Plugin 1', checked: false, type: 'folder' },
						{ id: 'plugin2', name: 'plugin2', label: 'Plugin 2', checked: false, type: 'folder' },
					];
				}
			}

			const optionsToSync = convertTreeToOptionsToSync( tree );
			expect( optionsToSync ).toEqual( {
				optionsToSync: [],
				specificSelections: undefined,
			} );
		} );

		it( 'handles mixed selection with database and partial plugins', () => {
			const { result } = renderHook( () => useDefaultSyncTree( 'push' ) );
			let tree = result.current;

			tree = updateNodeById( tree, 'filesAndFolders', { checked: false } );
			tree = updateNodeById( tree, 'themes', { checked: false } );
			tree = updateNodeById( tree, 'uploads', { checked: false } );
			tree = updateNodeById( tree, 'contents', { checked: false } );

			const wpContentNode = tree
				.find( ( node ) => node.id === 'filesAndFolders' )
				?.children?.find( ( node ) => node.id === 'wp-content' );
			if ( wpContentNode?.children ) {
				const pluginsNode = wpContentNode.children.find( ( node ) => node.id === 'plugins' );
				if ( pluginsNode ) {
					pluginsNode.checked = false;
					pluginsNode.indeterminate = true;
					pluginsNode.children = [
						{ id: 'plugin1', name: 'plugin1', label: 'Plugin 1', checked: true, type: 'folder' },
						{ id: 'plugin2', name: 'plugin2', label: 'Plugin 2', checked: false, type: 'folder' },
					];
				}
			}

			const optionsToSync = convertTreeToOptionsToSync( tree );
			expect( optionsToSync ).toEqual( {
				optionsToSync: [ 'sqls', 'plugins' ],
				specificSelections: {
					plugins: [ 'plugin1' ],
				},
			} );
		} );
	} );

	it( 'strips folder type prefix from specific selections', () => {
		const { result } = renderHook( () => useDefaultSyncTree( 'push' ) );
		let tree = result.current;

		tree = updateNodeById( tree, 'plugins', {
			children: [
				{
					id: 'plugins-my-plugin',
					name: 'my-plugin',
					label: 'my-plugin',
					checked: true,
					type: 'folder',
				},
				{
					id: 'plugins-another-plugin',
					name: 'another-plugin',
					label: 'another-plugin',
					checked: false,
					type: 'folder',
				},
			],
		} );

		const optionsToSync = convertTreeToOptionsToSync( tree );
		expect( optionsToSync ).toEqual( {
			optionsToSync: [ 'sqls', 'plugins', 'themes', 'uploads' ],
			specificSelections: {
				plugins: [ 'my-plugin' ],
			},
		} );
	} );
} );
