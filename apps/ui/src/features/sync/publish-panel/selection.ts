import { categorizePath, shouldLimitDepth } from '@studio/common/lib/sync/tree-utils';
import { backupLsItemSchema } from '@studio/common/types/sync-tree';
import type { TransferOptions } from './options';
import type { RawDirectoryEntry } from '@studio/common/types/sync-tree';

export type SyncNode = {
	id: string;
	name: string;
	path: string;
	folder: boolean;
	expandable: boolean;
	symlink?: boolean;
	checked: boolean;
	indeterminate?: boolean;
	children?: SyncNode[];
};

export function localNodes( entries: RawDirectoryEntry[] ): SyncNode[] {
	return entries
		.map( ( entry ) => ( {
			id: entry.path,
			name: entry.name,
			path: entry.path,
			folder: entry.isDirectory,
			expandable: entry.isDirectory && ! shouldLimitDepth( entry.path ),
			symlink: entry.isSymlink,
			checked: false,
			children: entry.children ? localNodes( entry.children ) : undefined,
		} ) )
		.sort( ( a, b ) => Number( b.folder ) - Number( a.folder ) || a.name.localeCompare( b.name ) );
}

export function remoteNodes( entries: Record< string, unknown >, path: string ): SyncNode[] {
	return Object.entries( entries ).map( ( [ name, raw ] ) => {
		const item = backupLsItemSchema.parse( raw );
		const fullPath = `${ path.replace( /\/$/, '' ) }/${ name }`;
		const folder = item.type === 'dir' || item.has_children === true;
		return {
			id: item.id,
			name,
			path: fullPath,
			folder,
			expandable: folder && ! shouldLimitDepth( fullPath.replace( /^\//, '' ) ),
			checked: false,
		};
	} );
}

export function checkNodes( nodes: SyncNode[], checked: boolean ): SyncNode[] {
	return nodes.map( ( node ) => ( {
		...node,
		checked,
		indeterminate: false,
		children: node.children && checkNodes( node.children, checked ),
	} ) );
}

// Applies `update` to the node with `id` and recomputes the tri-state of its ancestors.
export function updateNodes(
	nodes: SyncNode[],
	id: string,
	update: ( node: SyncNode ) => SyncNode
): SyncNode[] {
	return nodes.map( ( node ) => {
		if ( node.id === id ) {
			return update( node );
		}
		if ( ! node.children?.length ) {
			return node;
		}
		const children = updateNodes( node.children, id, update );
		const checked = children.every( ( child ) => child.checked );
		return {
			...node,
			children,
			checked,
			indeterminate:
				! checked && children.some( ( child ) => child.checked || child.indeterminate ),
		};
	} );
}

export function selectedNodes( nodes: SyncNode[] ): SyncNode[] {
	return nodes.flatMap( ( node ) =>
		node.checked ? [ node ] : selectedNodes( node.children ?? [] )
	);
}

export function syncOptions( nodes: SyncNode[], content: boolean ): TransferOptions {
	const selected = selectedNodes( nodes );
	const paths = selected.map( ( node ) =>
		node.path.replace( /^\/?wp-content\//, '' ).replace( /\/$/, '' )
	);
	return {
		push: {
			optionsToSync: [
				...( content ? [ 'sqls' as const ] : [] ),
				...new Set( paths.map( categorizePath ) ),
			],
			specificSelectionPaths: paths.length ? paths : undefined,
		},
		pull: {
			optionsToSync: [
				...( selected.length ? [ 'paths' as const ] : [] ),
				...( content ? [ 'sqls' as const ] : [] ),
			],
			includePathList: selected.map( ( node ) => node.id ),
		},
	};
}
