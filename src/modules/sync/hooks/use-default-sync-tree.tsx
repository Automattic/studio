import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import { TreeNode } from 'src/components/tree-view';
import { SYNC_OPTIONS } from 'src/constants';

export const useDefaultSyncTree = ( type: 'push' | 'pull' ): TreeNode[] => {
	const { __ } = useI18n();

	return useMemo( () => {
		const pushOptions: TreeNode[] = [
			{
				id: SYNC_OPTIONS.contents,
				name: SYNC_OPTIONS.contents,
				label: __( 'mu-plugins and fonts' ),
				checked: true,
				type: 'folder',
			},
		];
		return [
			{
				id: 'filesAndFolders',
				name: 'filesAndFolders',
				label: __( 'Files and folders' ),
				checked: true,
				indeterminate: false,
				expanded: false,
				hideExpandButton: true,
				children: [
					{
						id: 'wp-content',
						name: 'wp-content',
						label: 'wp-content',
						checked: true,
						indeterminate: false,
						type: 'folder',
						children: [
							{
								id: SYNC_OPTIONS.plugins,
								name: SYNC_OPTIONS.plugins,
								label: 'plugins',
								checked: true,
								type: 'folder',
								expanded: false,
							},
							{
								id: SYNC_OPTIONS.themes,
								name: SYNC_OPTIONS.themes,
								label: 'themes',
								checked: true,
								type: 'folder',
								expanded: false,
							},
							{
								id: SYNC_OPTIONS.uploads,
								name: SYNC_OPTIONS.uploads,
								label: 'uploads',
								checked: true,
								type: 'folder',
								expanded: false,
							},
							...( type === 'push' ? pushOptions : [] ),
						],
					},
				],
			},
			{
				id: SYNC_OPTIONS.sqls,
				name: SYNC_OPTIONS.sqls,
				label: __( 'Database' ),
				checked: true,
			},
		];
	}, [ __, type ] );
};
