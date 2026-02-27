import { TreeNode } from 'src/components/tree-view';
import { SYNC_OPTIONS } from 'src/constants';
import { convertTreeToPushOptions } from 'src/modules/sync/lib/convert-tree-to-sync-options';

// Helper to create a basic tree structure for testing with new file tree format
const createBaseTree = (): TreeNode[] => {
	return [
		{
			id: 'filesAndFolders',
			name: 'filesAndFolders',
			label: 'Files and folders',
			checked: false,
			indeterminate: false,
			expanded: false,
			hideExpandButton: true,
			children: [
				{
					id: 'wp-content',
					name: 'wp-content',
					label: 'wp-content',
					checked: false,
					indeterminate: false,
					type: 'folder',
					children: [],
				},
			],
		},
		{
			id: SYNC_OPTIONS.sqls,
			name: SYNC_OPTIONS.sqls,
			label: 'Database',
			checked: false,
		},
	];
};

describe( 'convertTreeToPushOptions', () => {
	it( 'returns ["all"] when all options are selected', () => {
		const tree = createBaseTree();
		tree[ 0 ].checked = true; // filesAndFolders
		tree[ 1 ].checked = true; // sqls

		const optionsToSync = convertTreeToPushOptions( tree );
		expect( optionsToSync ).toEqual( { optionsToSync: [ 'all' ] } );
	} );

	it( 'returns ["sqls"] when only database is selected', () => {
		const tree = createBaseTree();
		tree[ 1 ].checked = true; // sqls only

		const optionsToSync = convertTreeToPushOptions( tree );
		expect( optionsToSync ).toEqual( { optionsToSync: [ 'sqls' ] } );
	} );

	it( 'returns ["plugins"] when only plugins are selected', () => {
		const tree = createBaseTree();
		const wpContentNode = tree[ 0 ].children![ 0 ];
		wpContentNode.children = [
			{
				id: 'my-plugin',
				name: 'my-plugin',
				label: 'My Plugin',
				checked: true,
				type: 'folder',
				path: 'wp-content/plugins/my-plugin',
				pathId: 'plugins/my-plugin',
			},
		];

		const optionsToSync = convertTreeToPushOptions( tree );
		expect( optionsToSync ).toEqual( {
			optionsToSync: [ 'plugins' ],
			specificSelectionPaths: [ 'plugins/my-plugin' ],
		} );
	} );

	it( 'returns ["uploads"] when only uploads are selected', () => {
		const tree = createBaseTree();
		const wpContentNode = tree[ 0 ].children![ 0 ];
		wpContentNode.children = [
			{
				id: '2024-folder',
				name: '2024',
				label: '2024',
				checked: true,
				type: 'folder',
				path: 'wp-content/uploads/2024',
				pathId: 'uploads/2024',
			},
		];

		const optionsToSync = convertTreeToPushOptions( tree );
		expect( optionsToSync ).toEqual( {
			optionsToSync: [ 'uploads' ],
			specificSelectionPaths: [ 'uploads/2024' ],
		} );
	} );

	it( 'returns ["sqls", "plugins"] when both are selected', () => {
		const tree = createBaseTree();
		tree[ 1 ].checked = true; // sqls
		const wpContentNode = tree[ 0 ].children![ 0 ];
		wpContentNode.children = [
			{
				id: 'my-plugin',
				name: 'my-plugin',
				label: 'My Plugin',
				checked: true,
				type: 'folder',
				path: 'wp-content/plugins/my-plugin',
				pathId: 'plugins/my-plugin',
			},
		];

		const optionsToSync = convertTreeToPushOptions( tree );
		expect( optionsToSync ).toEqual( {
			optionsToSync: [ 'sqls', 'plugins' ],
			specificSelectionPaths: [ 'plugins/my-plugin' ],
		} );
	} );

	it( 'returns ["plugins", "themes", "uploads", "contents"] when "All files and folders" is selected', () => {
		const tree = createBaseTree();
		tree[ 0 ].checked = true; // filesAndFolders
		tree[ 1 ].checked = false; // sqls
		const wpContentNode = tree[ 0 ].children![ 0 ];
		wpContentNode.checked = true;
		wpContentNode.children = [
			{
				id: 'local-wp-content/fonts',
				name: 'fonts',
				label: 'fonts',
				checked: true,
				type: 'folder',
				path: 'wp-content/fonts',
				pathId: 'wp-content/fonts',
				children: [],
			},
			{
				id: 'local-wp-content/mu-plugins',
				name: 'mu-plugins',
				label: 'mu-plugins',
				checked: true,
				type: 'folder',
				path: 'wp-content/mu-plugins',
				pathId: 'wp-content/mu-plugins',
				children: [],
			},
			{
				id: 'local-wp-content/plugins',
				name: 'plugins',
				label: 'plugins',
				checked: true,
				type: 'folder',
				path: 'wp-content/plugins',
				pathId: 'wp-content/plugins',
				children: [
					{
						id: 'local-wp-content/plugins/akismet',
						name: 'akismet',
						label: 'akismet',
						checked: true,
						type: 'plugin',
						path: 'wp-content/plugins/akismet',
						pathId: 'wp-content/plugins/akismet',
						children: [],
					},
				],
				indeterminate: false,
			},
			{
				id: 'local-wp-content/themes',
				name: 'themes',
				label: 'themes',
				checked: true,
				type: 'folder',
				path: 'wp-content/themes',
				pathId: 'wp-content/themes',
				children: [
					{
						id: 'local-wp-content/themes/twentytwentyfive',
						name: 'twentytwentyfive',
						label: 'twentytwentyfive',
						checked: true,
						type: 'theme',
						path: 'wp-content/themes/twentytwentyfive',
						pathId: 'wp-content/themes/twentytwentyfive',
						children: [],
					},
				],
				indeterminate: false,
			},
			{
				id: 'local-wp-content/uploads',
				name: 'uploads',
				label: 'uploads',
				checked: true,
				type: 'folder',
				path: 'wp-content/uploads',
				pathId: 'wp-content/uploads',
				children: [
					{
						id: 'local-wp-content/uploads/2025',
						name: '2025',
						label: '2025',
						checked: true,
						type: 'folder',
						path: 'wp-content/uploads/2025',
						pathId: 'wp-content/uploads/2025',
						children: [],
						indeterminate: false,
					},
				],
				indeterminate: false,
			},
			{
				id: 'local-wp-content/index-php',
				name: 'index.php',
				label: 'index.php',
				checked: true,
				type: 'file',
				path: 'wp-content/index.php',
				pathId: 'wp-content/index.php',
			},
		];
		const optionsToSync = convertTreeToPushOptions( tree );
		expect( optionsToSync ).toEqual( {
			optionsToSync: [ 'contents', 'plugins', 'themes', 'uploads' ],
			specificSelectionPaths: [
				'fonts',
				'mu-plugins',
				'plugins',
				'themes',
				'uploads',
				'index.php',
			],
		} );
	} );

	describe( 'partial selections', () => {
		it( 'returns partial plugins selection when only some plugins are selected', () => {
			const tree = createBaseTree();
			const wpContentNode = tree[ 0 ].children![ 0 ];
			wpContentNode.children = [
				{
					id: 'plugin1',
					name: 'plugin1',
					label: 'Plugin 1',
					checked: true,
					type: 'folder',
					path: 'wp-content/plugins/plugin1',
					pathId: 'plugins/plugin1',
				},
				{
					id: 'plugin3',
					name: 'plugin3',
					label: 'Plugin 3',
					checked: true,
					type: 'folder',
					path: 'wp-content/plugins/plugin3',
					pathId: 'plugins/plugin3',
				},
			];

			const optionsToSync = convertTreeToPushOptions( tree );
			expect( optionsToSync ).toEqual( {
				optionsToSync: [ 'plugins' ],
				specificSelectionPaths: [ 'plugins/plugin1', 'plugins/plugin3' ],
			} );
		} );

		it( 'returns partial themes selection when only some themes are selected', () => {
			const tree = createBaseTree();
			const wpContentNode = tree[ 0 ].children![ 0 ];
			wpContentNode.children = [
				{
					id: 'theme1',
					name: 'theme1',
					label: 'Theme 1',
					checked: true,
					type: 'folder',
					path: 'wp-content/themes/theme1',
					pathId: 'themes/theme1',
				},
				{
					id: 'theme3',
					name: 'theme3',
					label: 'Theme 3',
					checked: true,
					type: 'folder',
					path: 'wp-content/themes/theme3',
					pathId: 'themes/theme3',
				},
			];

			const optionsToSync = convertTreeToPushOptions( tree );
			expect( optionsToSync ).toEqual( {
				optionsToSync: [ 'themes' ],
				specificSelectionPaths: [ 'themes/theme1', 'themes/theme3' ],
			} );
		} );

		it( 'returns partial uploads selection when only some uploads are selected', () => {
			const tree = createBaseTree();
			const wpContentNode = tree[ 0 ].children![ 0 ];
			wpContentNode.children = [
				{
					id: 'upload1',
					name: 'upload1',
					label: 'Upload 1',
					checked: true,
					type: 'folder',
					path: 'wp-content/uploads/upload1',
					pathId: 'uploads/upload1',
				},
				{
					id: 'upload2',
					name: 'upload2',
					label: 'Upload 2',
					checked: true,
					type: 'folder',
					path: 'wp-content/uploads/upload2',
					pathId: 'uploads/upload2',
				},
			];

			const optionsToSync = convertTreeToPushOptions( tree );
			expect( optionsToSync ).toEqual( {
				optionsToSync: [ 'uploads' ],
				specificSelectionPaths: [ 'uploads/upload1', 'uploads/upload2' ],
			} );
		} );

		it( 'returns mixed partial selections for plugins and themes', () => {
			const tree = createBaseTree();
			const wpContentNode = tree[ 0 ].children![ 0 ];
			wpContentNode.children = [
				{
					id: 'plugin1',
					name: 'plugin1',
					label: 'Plugin 1',
					checked: true,
					type: 'folder',
					path: 'wp-content/plugins/plugin1',
					pathId: 'plugins/plugin1',
				},
				{
					id: 'theme1',
					name: 'theme1',
					label: 'Theme 1',
					checked: true,
					type: 'folder',
					path: 'wp-content/themes/theme1',
					pathId: 'themes/theme1',
				},
				{
					id: 'theme3',
					name: 'theme3',
					label: 'Theme 3',
					checked: true,
					type: 'folder',
					path: 'wp-content/themes/theme3',
					pathId: 'themes/theme3',
				},
			];

			const optionsToSync = convertTreeToPushOptions( tree );
			expect( optionsToSync ).toEqual( {
				optionsToSync: [ 'plugins', 'themes' ],
				specificSelectionPaths: [ 'plugins/plugin1', 'themes/theme1', 'themes/theme3' ],
			} );
		} );

		it( 'returns no specificSelections when all children are selected in a category', () => {
			const tree = createBaseTree();
			const wpContentNode = tree[ 0 ].children![ 0 ];
			wpContentNode.children = [
				{
					id: 'plugin1',
					name: 'plugin1',
					label: 'Plugin 1',
					checked: true,
					type: 'folder',
					path: 'wp-content/plugins/plugin1',
					pathId: 'plugins/plugin1',
				},
				{
					id: 'plugin2',
					name: 'plugin2',
					label: 'Plugin 2',
					checked: true,
					type: 'folder',
					path: 'wp-content/plugins/plugin2',
					pathId: 'plugins/plugin2',
				},
			];

			const optionsToSync = convertTreeToPushOptions( tree );
			expect( optionsToSync ).toEqual( {
				optionsToSync: [ 'plugins' ],
				specificSelectionPaths: [ 'plugins/plugin1', 'plugins/plugin2' ],
			} );
		} );

		it( 'handles mixed selection with database and partial plugins', () => {
			const tree = createBaseTree();
			tree[ 1 ].checked = true; // sqls
			const wpContentNode = tree[ 0 ].children![ 0 ];
			wpContentNode.children = [
				{
					id: 'plugin1',
					name: 'plugin1',
					label: 'Plugin 1',
					checked: true,
					type: 'folder',
					path: 'wp-content/plugins/plugin1',
					pathId: 'plugins/plugin1',
				},
			];

			const optionsToSync = convertTreeToPushOptions( tree );
			expect( optionsToSync ).toEqual( {
				optionsToSync: [ 'sqls', 'plugins' ],
				specificSelectionPaths: [ 'plugins/plugin1' ],
			} );
		} );
	} );

	it( 'strips folder type prefix from specific selections', () => {
		const tree = createBaseTree();
		tree[ 1 ].checked = true; // sqls
		const wpContentNode = tree[ 0 ].children![ 0 ];
		wpContentNode.children = [
			{
				id: 'my-plugin',
				name: 'my-plugin',
				label: 'My Plugin',
				checked: true,
				type: 'folder',
				path: 'wp-content/plugins/my-plugin',
				pathId: 'plugins/my-plugin',
			},
		];

		const optionsToSync = convertTreeToPushOptions( tree );
		expect( optionsToSync ).toEqual( {
			optionsToSync: [ 'sqls', 'plugins' ],
			specificSelectionPaths: [ 'plugins/my-plugin' ],
		} );
	} );
} );
