import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import { TreeNode } from 'src/components/tree-view';
import { SYNC_OPTIONS } from 'src/constants';

export const useTopLevelSyncTree = (): TreeNode[] => {
	const { __ } = useI18n();

	return useMemo( () => {
		return [
			{
				id: 'filesAndFolders',
				name: 'filesAndFolders',
				label: __( 'Files and folders' ),
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
						expanded: true,
					},
				],
			},
			{
				id: SYNC_OPTIONS.sqls,
				name: SYNC_OPTIONS.sqls,
				label: __( 'Database' ),
				checked: false,
			},
		];
	}, [ __ ] );
};
