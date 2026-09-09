import { categorizePath } from '@studio/common/lib/sync/tree-utils';
import { __ } from '@wordpress/i18n';
import type { TreeNode } from './sync-tree';
import type { PullSyncOptions, PushSyncOptions, SyncOption } from '@studio/common/types/sync';

// The tree's two roots. Everything a sync can carry is either the database or
// something under wp-content.
export const DATABASE_NODE_ID = 'sqls';
export const FILES_NODE_ID = 'filesAndFolders';
export const WP_CONTENT_NODE_ID = 'wp-content';

/** The tree as it stands before any directory has been listed. */
export function createInitialTree(): TreeNode[] {
	return [
		{
			id: DATABASE_NODE_ID,
			name: DATABASE_NODE_ID,
			label: __( 'Database' ),
			checked: true,
		},
		{
			id: FILES_NODE_ID,
			name: FILES_NODE_ID,
			label: __( 'Files and folders' ),
			checked: true,
			expanded: true,
			hideExpandButton: true,
			children: [
				{
					id: WP_CONTENT_NODE_ID,
					name: WP_CONTENT_NODE_ID,
					label: 'wp-content',
					checked: true,
					type: 'folder',
					expanded: false,
					children: [],
				},
			],
		},
	];
}

/**
 * The nodes a sync should carry: a checked node stands for its whole subtree,
 * so recursion stops there. A mixed node contributes only its checked
 * descendants.
 */
function collectChecked( nodes: TreeNode[] | undefined ): TreeNode[] {
	if ( ! nodes?.length ) {
		return [];
	}
	const result: TreeNode[] = [];
	for ( const node of nodes ) {
		if ( node.checked ) {
			result.push( node );
		} else if ( node.indeterminate && node.children?.length ) {
			result.push( ...collectChecked( node.children ) );
		}
	}
	return result;
}

function findNode( nodes: TreeNode[], id: string ): TreeNode | undefined {
	for ( const node of nodes ) {
		if ( node.id === id ) {
			return node;
		}
		const found = node.children ? findNode( node.children, id ) : undefined;
		if ( found ) {
			return found;
		}
	}
	return undefined;
}

function roots( tree: TreeNode[] ) {
	return {
		database: findNode( tree, DATABASE_NODE_ID ),
		files: findNode( tree, FILES_NODE_ID ),
		wpContent: findNode( tree, WP_CONTENT_NODE_ID ),
	};
}

/** True when the whole site is selected, which both sides express as `all`. */
export function isWholeSite( tree: TreeNode[] ): boolean {
	const { database, files } = roots( tree );
	return Boolean( database?.checked && files?.checked );
}

export function hasSelection( tree: TreeNode[] ): boolean {
	const { database, files } = roots( tree );
	return Boolean(
		database?.checked || files?.checked || files?.indeterminate || database?.indeterminate
	);
}

/**
 * Push selects local paths. Each checked path also contributes the category it
 * falls into, because the export layer decides what to archive from the
 * categories and then narrows to the paths.
 */
export function toPushOptions( tree: TreeNode[] ): PushSyncOptions | undefined {
	if ( isWholeSite( tree ) ) {
		return undefined;
	}

	const { database, wpContent } = roots( tree );
	const optionsToSync: SyncOption[] = [];
	let specificSelectionPaths: string[] | undefined;

	if ( database?.checked ) {
		optionsToSync.push( 'sqls' );
	}

	const paths = new Set< string >();
	const categories = new Set< SyncOption >();
	for ( const node of collectChecked( wpContent?.children ) ) {
		if ( ! node.path ) {
			continue;
		}
		const relative = node.path.replace( /^\/?wp-content\//, '' );
		paths.add( relative );
		categories.add( categorizePath( relative ) );
	}

	if ( paths.size > 0 ) {
		optionsToSync.push( ...categories );
		specificSelectionPaths = [ ...paths ];
	}

	return { optionsToSync, ...( specificSelectionPaths ? { specificSelectionPaths } : {} ) };
}

/**
 * Pull selects remote backup node ids rather than paths, and marks the run
 * with `paths` so the CLI knows to read the include list.
 */
export function toPullOptions( tree: TreeNode[] ): PullSyncOptions | undefined {
	if ( isWholeSite( tree ) ) {
		return undefined;
	}

	const { database, wpContent } = roots( tree );
	const optionsToSync: SyncOption[] = database?.checked ? [ 'sqls' ] : [];
	const includePathList = collectChecked( wpContent?.children )
		.map( ( node ) => node.pathId )
		.filter( ( pathId ): pathId is string => Boolean( pathId ) );

	if ( includePathList.length > 0 ) {
		optionsToSync.unshift( 'paths' );
		return { optionsToSync, includePathList };
	}

	return { optionsToSync };
}
