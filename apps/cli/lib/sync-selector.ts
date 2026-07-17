import { categorizePath } from '@studio/common/lib/sync/tree-utils';
import { __ } from '@wordpress/i18n';
import { fetchLatestRewindId, fetchRemoteFileTree } from 'cli/lib/sync-api';
import { listLocalFileTree } from 'cli/lib/sync-file-tree';
import treeCheckbox from 'cli/lib/tree-checkbox';
import type { RemoteFileEntry } from '@studio/common/lib/sync/sync-api';
import type { SyncOption } from '@studio/common/types/sync';
import type { RawDirectoryEntry } from '@studio/common/types/sync-tree';
import type { TreeNode } from 'cli/lib/tree-checkbox';

function sortNodes( nodes: TreeNode[] ): TreeNode[] {
	return [ ...nodes ].sort( ( a, b ) => a.name.localeCompare( b.name ) );
}

function buildTreeFromLocal( entries: RawDirectoryEntry[], depth: number = 1 ): TreeNode[] {
	return sortNodes(
		entries.map( ( entry ) => {
			const relativePath = entry.path.replace( /^wp-content\//, '' );
			return {
				name: entry.name + ( entry.isDirectory ? '/' : '' ),
				value: relativePath,
				isDirectory: entry.isDirectory,
				checked: true,
				expanded: false,
				depth,
				children: entry.children?.length
					? buildTreeFromLocal( entry.children, depth + 1 )
					: undefined,
			};
		} )
	);
}

function buildTreeFromRemote( entries: RemoteFileEntry[], depth: number = 1 ): TreeNode[] {
	return sortNodes(
		entries.map( ( entry ) => ( {
			name: entry.name + ( entry.isDirectory ? '/' : '' ),
			value: entry.path.replace( /^\/?wp-content\//, '' ),
			isDirectory: entry.isDirectory,
			checked: true,
			expanded: false,
			depth,
			pathId: entry.pathId,
		} ) )
	);
}

export function buildRootTree( wpContentChildren: TreeNode[] ): TreeNode[] {
	return [
		{
			name: __( 'Database' ),
			value: 'database',
			isDirectory: false,
			checked: true,
			expanded: false,
			depth: 0,
		},
		{
			name: 'wp-content/',
			value: 'wp-content',
			isDirectory: true,
			checked: true,
			expanded: true,
			depth: 0,
			children: wpContentChildren,
		},
	];
}

function convertCheckedToSyncOptions( selected: TreeNode[] ): {
	optionsToSync: SyncOption[];
	specificSelectionPaths?: string[];
} {
	const hasDatabase = selected.some( ( n ) => n.value === 'database' );
	const wpContentItems = selected.filter(
		( n ) => n.value !== 'database' && n.value !== 'wp-content'
	);

	if ( hasDatabase && wpContentItems.length === 0 ) {
		return { optionsToSync: [ 'sqls' ] };
	}

	const optionsToSync: SyncOption[] = [];
	const specificSelectionPaths: string[] = [];

	if ( hasDatabase ) {
		optionsToSync.push( 'sqls' );
	}

	const categories = new Set< SyncOption >();
	for ( const node of wpContentItems ) {
		categories.add( categorizePath( node.value ) );
		specificSelectionPaths.push( node.value );
	}

	optionsToSync.push( ...categories );

	return {
		optionsToSync,
		specificSelectionPaths: specificSelectionPaths.length > 0 ? specificSelectionPaths : undefined,
	};
}

function convertCheckedToPullOptions( selected: TreeNode[] ): {
	optionsToSync: SyncOption[];
	includePathList?: string[];
} {
	const hasDatabase = selected.some( ( n ) => n.value === 'database' );
	const wpContentItems = selected.filter(
		( n ) => n.value !== 'database' && n.value !== 'wp-content'
	);

	if ( hasDatabase && wpContentItems.length === 0 ) {
		return { optionsToSync: [ 'sqls' ] };
	}

	const optionsToSync: SyncOption[] = [];
	const pathIds: string[] = [];

	if ( hasDatabase ) {
		optionsToSync.push( 'sqls' );
	}

	for ( const node of wpContentItems ) {
		if ( node.pathId ) {
			pathIds.push( node.pathId );
		}
	}

	if ( pathIds.length > 0 ) {
		optionsToSync.unshift( 'paths' );
	}

	return {
		optionsToSync,
		includePathList: pathIds.length > 0 ? pathIds : undefined,
	};
}

function isAllSelected( selected: TreeNode[] ): boolean {
	const hasDatabase = selected.some( ( n ) => n.value === 'database' );
	const hasWpContent = selected.some( ( n ) => n.value === 'wp-content' && n.checked );
	return hasDatabase && hasWpContent;
}

export async function selectSyncItemsForPush(
	sitePath: string
): Promise< { optionsToSync: SyncOption[]; specificSelectionPaths?: string[] } | undefined > {
	const entries = await listLocalFileTree( sitePath, 'wp-content', 2 );

	if ( entries.length === 0 ) {
		return { optionsToSync: [ 'all' ] };
	}

	const wpContentChildren = buildTreeFromLocal( entries );
	const tree = buildRootTree( wpContentChildren );

	const selected = await treeCheckbox( {
		message: __( 'Select items to sync' ),
		tree,
	} );

	if ( selected.length === 0 ) {
		return undefined;
	}

	if ( isAllSelected( selected ) ) {
		return { optionsToSync: [ 'all' ] };
	}

	return convertCheckedToSyncOptions( selected );
}

export async function fetchPullTree(
	token: string,
	remoteSiteId: number
): Promise< { tree: TreeNode[]; rewindId: string } > {
	const rewindId = await fetchLatestRewindId( token, remoteSiteId );
	const entries = await fetchRemoteFileTree( token, remoteSiteId, rewindId, '/wp-content/' );

	const wpContentChildren = buildTreeFromRemote( entries );
	const tree = buildRootTree( wpContentChildren );
	return { tree, rewindId };
}

export async function selectSyncItemsForPull(
	token: string,
	remoteSiteId: number,
	tree: TreeNode[]
): Promise< { optionsToSync: SyncOption[]; includePathList?: string[] } | undefined > {
	if ( tree.length === 0 ) {
		return { optionsToSync: [ 'all' ] };
	}

	const selected = await treeCheckbox( {
		message: __( 'Select items to sync' ),
		tree,
		onExpand: async ( node ) => {
			const rewindId = await fetchLatestRewindId( token, remoteSiteId );
			const entries = await fetchRemoteFileTree(
				token,
				remoteSiteId,
				rewindId,
				`/wp-content/${ node.value }`
			);
			return buildTreeFromRemote( entries, node.depth + 1 );
		},
	} );

	if ( selected.length === 0 ) {
		return undefined;
	}

	if ( isAllSelected( selected ) ) {
		return { optionsToSync: [ 'all' ] };
	}

	return convertCheckedToPullOptions( selected );
}
