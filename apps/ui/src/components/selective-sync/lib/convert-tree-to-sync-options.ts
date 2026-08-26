import { categorizePath } from '@studio/common/lib/sync/tree-utils';
import { PullSiteOptions } from '@/components/selective-sync/data/sync-stores';
import { SYNC_OPTIONS } from '@/components/selective-sync/lib/constants';
import type { SyncOption } from '@/components/selective-sync/lib/types';
import type { TreeNode } from '@/components/selective-sync/tree-view';

type PushOptionsWithSelections = {
	optionsToSync: SyncOption[];
	specificSelectionPaths?: string[];
};

export type ReprintPullOptions = {
	onlyPaths: string[];
	skipDatabase: boolean;
};

/**
 * `/wp-content/plugins/akismet/` → `plugins/akismet`. Remote tree paths are
 * always slash-terminated, files included.
 */
const toWpContentRelativePath = ( nodePath: string | undefined ): string | undefined => {
	if ( ! nodePath ) {
		return undefined;
	}
	return nodePath.replace( /^\/?wp-content\//, '' ).replace( /\/+$/, '' ) || undefined;
};

const collectCheckedNodes = ( nodes: TreeNode[] | undefined ): TreeNode[] => {
	if ( ! nodes?.length ) {
		return [];
	}

	const result: TreeNode[] = [];
	for ( const node of nodes ) {
		if ( node.checked ) {
			result.push( node );
		} else if ( node.indeterminate && node.children?.length ) {
			result.push( ...collectCheckedNodes( node.children ) );
		}
	}
	return result;
};

const collectPathIds = ( nodes: TreeNode[] | undefined ): string[] => {
	return collectCheckedNodes( nodes )
		.map( ( node ) => node.pathId )
		.filter( ( pathId ): pathId is string => Boolean( pathId ) );
};

const convertTreeToSyncCategories = (
	nodes: TreeNode[] | undefined
): { paths: string[]; options: SyncOption[] } => {
	const checkedNodes = collectCheckedNodes( nodes );
	const paths = new Set< string >();
	const options = new Set< SyncOption >();

	for ( const node of checkedNodes ) {
		if ( ! node.path ) {
			continue;
		}

		const nodePath = node.path.replace( /^\/?wp-content\//, '' );
		paths.add( nodePath );
		options.add( categorizePath( nodePath ) );
	}

	return { paths: [ ...paths ], options: [ ...options ] };
};

const getCommonNodes = ( tree: TreeNode[] ) => {
	let isDatabaseSelected: TreeNode | undefined;
	let filesAndFolders: TreeNode | undefined;

	for ( const node of tree ) {
		if ( node.id === SYNC_OPTIONS.sqls ) {
			isDatabaseSelected = node;
		} else if ( node.id === 'filesAndFolders' ) {
			filesAndFolders = node;
		}
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

/**
 * The pull selection for the Reprint engine, which selects by
 * wp-content-relative path (`--only`) rather than by Jetpack backup node id.
 *
 * This mirrors `mapCheckedNodesToSelection` in
 * `apps/cli/lib/pull/reprint-selector.ts`, which reduces the CLI picker's
 * checked nodes the same way — a fully-checked directory stands for its
 * descendants, and a fully-checked `wp-content` needs no `--only` at all.
 * The two reductions have to agree, so they are tested against the same cases.
 *
 * Paths stay wp-content-relative; the CLI's `mapCliOnlyToReprint` turns them
 * into the `:wp-content:` sources Reprint expects.
 */
export const convertTreeToReprintPullOptions = ( tree: TreeNode[] ): ReprintPullOptions => {
	const { isDatabaseSelected, filesAndFolders, wpContent } = getCommonNodes( tree );

	if ( ! filesAndFolders || ! isDatabaseSelected ) {
		throw new Error(
			'Error when converting tree to pull options. Database or files and folders not found'
		);
	}

	const skipDatabase = ! isDatabaseSelected.checked;

	// Every file is selected, so the pull needs no `--only` to restrict it.
	if ( filesAndFolders.checked || wpContent?.checked ) {
		return { onlyPaths: [], skipDatabase };
	}

	// `collectCheckedNodes` descends only into partially-checked folders, so a
	// checked folder arrives on its own and its descendants are left out.
	const onlyPaths = collectCheckedNodes( wpContent?.children ?? [] )
		.map( ( node ) => toWpContentRelativePath( node.path ) )
		.filter( ( nodePath ): nodePath is string => Boolean( nodePath ) );

	return { onlyPaths: [ ...new Set( onlyPaths ) ], skipDatabase };
};
