import { SYNC_OPTIONS } from 'src/constants';
import { PullSiteOptions } from 'src/hooks/sync-sites/use-sync-pull';
import type { TreeNode } from 'src/components/tree-view';
import type { SyncOption } from 'src/types';

type PushOptionsWithSelections = {
	optionsToSync: SyncOption[];
	specificSelections?: {
		paths?: string[];
	};
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

		const p = node.path.replace( /^\/?wp-content\//, '' );
		paths.add( p );

		// Determine which category this belongs to for optionsToSync
		if ( p.startsWith( 'plugins/' ) ) {
			options.add( SYNC_OPTIONS.plugins );
		} else if ( p.startsWith( 'themes/' ) ) {
			options.add( SYNC_OPTIONS.themes );
		} else if ( p.startsWith( 'uploads/' ) ) {
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
	const specificSelections: NonNullable< PushOptionsWithSelections[ 'specificSelections' ] > = {};

	if ( tree.length > 0 && tree.every( ( node ) => node.checked ) ) {
		optionsToSync.push( SYNC_OPTIONS.all );
		return { optionsToSync, specificSelections: undefined };
	}

	const { isDatabaseSelected, wpContent } = getCommonNodes( tree );

	if ( isDatabaseSelected?.checked ) {
		optionsToSync.push( SYNC_OPTIONS.sqls );
	}

	if ( wpContent?.children?.length ) {
		const { paths, options } = convertTreeToSyncCategories( wpContent.children );

		if ( paths.length ) {
			optionsToSync.push( ...options );
			specificSelections.paths = paths;
		}
	}

	return {
		optionsToSync,
		specificSelections: Object.keys( specificSelections ).length ? specificSelections : undefined,
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
