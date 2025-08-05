import { SYNC_OPTIONS } from 'src/constants';
import { PullSiteOptions } from 'src/hooks/sync-sites/use-sync-pull';
import type { TreeNode } from 'src/components/tree-view';

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

export const convertTreeToPullOptions = ( tree: TreeNode[] ): PullSiteOptions => {
	const isDatabaseSelected = tree.find( ( node ) => node.id === SYNC_OPTIONS.sqls )?.checked;
	const filesAndFolders = tree.find( ( node ) => node.id === 'filesAndFolders' );
	if ( ! filesAndFolders ) {
		return isDatabaseSelected ? { optionsToSync: [ SYNC_OPTIONS.sqls ] } : { optionsToSync: [] };
	}
	const wpContent = filesAndFolders.children?.find( ( node ) => node.id === 'wp-content' );
	const pathIds = collectPathIds( wpContent?.children ?? [] );

	const pullOptions: PullSiteOptions = {
		optionsToSync: pathIds.length > 0 ? [ SYNC_OPTIONS.paths ] : [],
	};

	if ( pathIds.length > 0 ) {
		pullOptions.include_path_list = pathIds;
	}

	if ( isDatabaseSelected ) {
		pullOptions.optionsToSync.push( SYNC_OPTIONS.sqls );
	}

	return pullOptions;
};
