import { SYNC_OPTIONS } from 'src/constants';
import { PullSiteOptions } from 'src/hooks/sync-sites/use-sync-pull';
import type { TreeNode } from 'src/components/tree-view';
import type { SyncOption } from 'src/types';

type PushOptionsWithSelections = {
	optionsToSync: SyncOption[];
	specificSelectionPaths?: string[];
};

const iterateOverCheckedNodes = (
	nodes: TreeNode[] | undefined,
	visit: ( node: TreeNode ) => void
): void => {
	if ( ! nodes?.length ) return;
	for ( const node of nodes ) {
		if ( node.checked ) {
			visit( node );
		} else if ( node.indeterminate && node.children?.length ) {
			iterateOverCheckedNodes( node.children, visit );
		}
	}
};

const collectPathIds = ( nodes: TreeNode[] | undefined ): string[] => {
	const out: string[] = [];
	iterateOverCheckedNodes( nodes, ( node ) => {
		if ( node.pathId ) out.push( node.pathId );
	} );
	return out;
};

const convertTreeToSyncCategories = (
	nodes: TreeNode[] | undefined
): { paths: string[]; options: SyncOption[] } => {
	const paths = new Set< string >();
	const options = new Set< SyncOption >();

	iterateOverCheckedNodes( nodes, ( node ) => {
		if ( ! node.path ) return;

		const nodePath = node.path.replace( /^\/?wp-content\//, '' );
		paths.add( nodePath );

		// Determine which category this belongs to for optionsToSync
		if ( nodePath.startsWith( 'plugins/' ) ) {
			options.add( SYNC_OPTIONS.plugins );
		} else if ( nodePath.startsWith( 'themes/' ) ) {
			options.add( SYNC_OPTIONS.themes );
		} else if ( nodePath.startsWith( 'uploads/' ) ) {
			options.add( SYNC_OPTIONS.uploads );
		} else {
			options.add( SYNC_OPTIONS.contents );
		}
	} );

	return { paths: [ ...paths ], options: [ ...options ] };
};

const getCommonNodes = ( tree: TreeNode[] ) => {
	let isDatabaseSelected: TreeNode | undefined;
	let filesAndFolders: TreeNode | undefined;

	for ( const node of tree ) {
		if ( node.id === SYNC_OPTIONS.sqls ) isDatabaseSelected = node;
		else if ( node.id === 'filesAndFolders' ) filesAndFolders = node;
	}

	const wpContent = filesAndFolders?.children?.find( ( n ) => n.id === 'wp-content' );

	return { isDatabaseSelected, filesAndFolders, wpContent };
};

export const convertTreeToPushOptions = ( tree: TreeNode[] ): PushOptionsWithSelections => {
	const optionsToSync: SyncOption[] = [];
	let specificSelectionPaths: string[] | undefined;

	if ( tree.length > 0 && tree.every( ( node ) => node.checked ) ) {
		optionsToSync.push( SYNC_OPTIONS.all );
		return { optionsToSync };
	}

	const { isDatabaseSelected, wpContent } = getCommonNodes( tree );

	if ( isDatabaseSelected?.checked ) {
		optionsToSync.push( SYNC_OPTIONS.sqls );
	}

	if ( wpContent?.children?.length ) {
		const { paths, options } = convertTreeToSyncCategories( wpContent.children );

		if ( paths.length ) {
			optionsToSync.push( ...options );
			specificSelectionPaths = paths;
		}
	}

	return {
		optionsToSync,
		specificSelectionPaths,
	};
};

export const convertTreeToPullOptions = ( tree: TreeNode[] ): PullSiteOptions => {
	const { isDatabaseSelected, filesAndFolders, wpContent } = getCommonNodes( tree );

	if ( ! filesAndFolders || ! isDatabaseSelected ) {
		throw new Error(
			'Error when converting tree to pull options. Database or files and folders not found'
		);
	}

	if ( isDatabaseSelected.checked && filesAndFolders.checked ) {
		return {
			optionsToSync: [ SYNC_OPTIONS.all ],
		};
	}

	const pathIds = collectPathIds( wpContent?.children ?? [] );

	const pullOptions: PullSiteOptions = {
		optionsToSync: isDatabaseSelected.checked ? [ SYNC_OPTIONS.sqls ] : [],
	};

	if ( pathIds.length > 0 ) {
		pullOptions.optionsToSync.unshift( SYNC_OPTIONS.paths );
		pullOptions.include_path_list = pathIds;
	}

	return pullOptions;
};
