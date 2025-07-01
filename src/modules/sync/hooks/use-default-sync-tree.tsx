import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import { TreeNode } from 'src/components/tree-view';
import { SYNC_OPTIONS } from 'src/constants';

export const useDefaultSyncTree = (): TreeNode[] => {
	const { __ } = useI18n();

	return useMemo( () => {
		return [
			{
				id: 'filesAndFolders',
				label: __( 'Files and folders' ),
				checked: true,
				indeterminate: false,
				expanded: false,
				hideExpandButton: true,
				children: [
					{
						id: 'wp-content',
						label: 'wp-content',
						checked: true,
						indeterminate: false,
						type: 'folder',
						children: [
							{
								id: SYNC_OPTIONS.plugins,
								label: 'plugins',
								checked: true,
								type: 'folder',
								expanded: false,
							},
							{
								id: SYNC_OPTIONS.themes,
								label: 'themes',
								checked: true,
								type: 'folder',
								expanded: false,
							},
							{
								id: SYNC_OPTIONS.uploads,
								label: 'uploads',
								checked: true,
								type: 'folder',
								expanded: false,
							},
							{
								id: SYNC_OPTIONS.contents,
								label: __( 'Other files and directories' ),
								checked: true,
								type: 'folder',
							},
						],
					},
				],
			},
			{
				id: SYNC_OPTIONS.sqls,
				label: __( 'Database' ),
				checked: true,
			},
		];
	}, [ __ ] );
};
