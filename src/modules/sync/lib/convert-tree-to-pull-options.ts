import { SYNC_OPTIONS } from 'src/constants';
import type { TreeNode } from 'src/components/tree-view';

export interface PullSyncOptions {
	options: string[];
	include_path_list?: string[];
}

const collectPathIds = ( nodes: TreeNode[], pathIds: string[] = [] ): string[] => {
	nodes.forEach( ( node ) => {
		if ( node.checked && node.pathId ) {
			pathIds.push( node.pathId );
		} else if ( node.indeterminate && node.children ) {
			collectPathIds( node.children, pathIds );
		}
	} );

	return pathIds;
};

export const convertTreeToPullOptions = ( tree: TreeNode[] ): PullSyncOptions => {
	const isDatabaseSelected = tree.find( ( node ) => node.id === SYNC_OPTIONS.sqls )?.checked;
	const filesAndFolders = tree.find( ( node ) => node.id === 'filesAndFolders' );
	if ( ! filesAndFolders ) {
		return isDatabaseSelected ? { options: [ SYNC_OPTIONS.sqls ] } : { options: [] };
	}
	const wpContent = filesAndFolders.children?.find( ( node ) => node.id === 'wp-content' );
	const pathIds = collectPathIds( wpContent?.children ?? [] );

	const pullOptions: PullSyncOptions = {
		options: pathIds.length > 0 ? [ 'paths' ] : [],
	};

	if ( pathIds.length > 0 ) {
		pullOptions.include_path_list = pathIds;
	}

	if ( isDatabaseSelected ) {
		pullOptions.options.push( SYNC_OPTIONS.sqls );
	}

	return pullOptions;
};
