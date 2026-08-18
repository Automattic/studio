import { shouldLimitDepth } from '@studio/common/lib/sync/tree-utils';
import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { brush, chevronRight, Icon, page, plugins, file as folder } from '@wordpress/icons';
import { clsx } from 'clsx';
import { useEffect, useRef } from 'react';
import styles from './sync-tree.module.css';
import type { RawDirectoryEntry } from '@studio/common/types/sync-tree';
import type { Dispatch, SetStateAction } from 'react';

export type TreeNodeType = 'folder' | 'file' | 'plugin' | 'theme';

export type TreeNode = {
	id: string;
	name: string;
	label: string;
	checked: boolean;
	indeterminate?: boolean;
	expanded?: boolean;
	hideExpandButton?: boolean;
	children?: TreeNode[];
	type?: TreeNodeType;
	loading?: boolean;
	// Remote backup node id, used by pull's `includePathList`.
	pathId?: string;
	// Path relative to the site root, used by push's `specificSelectionPaths`.
	path?: string;
};

const NODE_ICONS: Record< TreeNodeType, typeof folder > = {
	folder,
	file: page,
	plugin: plugins,
	theme: brush,
};

/**
 * Applies a patch to a node and reconciles the tri-state of everything around
 * it: checking a folder checks its whole subtree, and every ancestor becomes
 * checked, indeterminate, or clear depending on what its children ended up as.
 */
function updateNode( node: TreeNode, patch: Partial< TreeNode > ): TreeNode {
	const updated = { ...node, ...patch };

	if ( updated.children && updated.children.length > 0 ) {
		updated.children = updated.children.map( ( child ) =>
			'checked' in patch ? updateNode( child, { checked: patch.checked } ) : child
		);
		const checkedCount = updated.children.filter( ( child ) => child.checked ).length;
		updated.checked = checkedCount === updated.children.length;
		updated.indeterminate = checkedCount > 0 && checkedCount < updated.children.length;
	}

	return updated;
}

export function updateNodeById(
	nodes: TreeNode[],
	id: string,
	patch: Partial< TreeNode >
): TreeNode[] {
	return nodes.map( ( node ) => {
		if ( node.id === id ) {
			return updateNode( node, patch );
		}
		if ( node.children && node.children.length > 0 ) {
			const children = updateNodeById( node.children, id, patch );
			const checkedCount = children.filter( ( child ) => child.checked ).length;
			return {
				...node,
				checked: checkedCount === children.length,
				indeterminate:
					( checkedCount > 0 && checkedCount < children.length ) ||
					children.some( ( child ) => child.indeterminate ),
				children,
			};
		}
		return node;
	} );
}

/** Turns a directory listing into tree nodes, folders first then alphabetical. */
export function convertRawToTreeNodes( rawNodes: RawDirectoryEntry[] ): TreeNode[] {
	const pluginPath = /^plugins\/[^/]+$/;
	const themePath = /^themes\/[^/]+$/;

	return rawNodes
		.map( ( raw ): TreeNode => {
			let type: TreeNodeType = raw.isDirectory ? 'folder' : 'file';
			if ( raw.isDirectory ) {
				const relative = raw.path.replace( /^wp-content\//, '' );
				if ( pluginPath.test( relative ) ) {
					type = 'plugin';
				} else if ( themePath.test( relative ) ) {
					type = 'theme';
				}
			}

			return {
				id: `local-${ raw.path.replace( /[^a-zA-Z0-9/]/g, '-' ) }`,
				name: raw.name,
				label: raw.name,
				checked: false,
				type,
				path: raw.path,
				pathId: raw.path,
				children: raw.children
					? convertRawToTreeNodes( raw.children )
					: raw.isDirectory
					? []
					: undefined,
				expanded: false,
				// A plugin or theme syncs whole; there's nothing useful to pick
				// inside one, so don't offer to open it.
				hideExpandButton: shouldLimitDepth( raw.path ),
			};
		} )
		.sort( ( a, b ) => {
			if ( a.type !== b.type ) {
				const order = { folder: 0, plugin: 1, theme: 2, file: 3 };
				return order[ a.type as TreeNodeType ] - order[ b.type as TreeNodeType ];
			}
			return a.name.toLowerCase().localeCompare( b.name.toLowerCase() );
		} );
}

/** Native checkbox so the indeterminate state can be set on the DOM node. */
function TriStateCheckbox( {
	checked,
	indeterminate,
	disabled,
	onChange,
	label,
}: {
	checked: boolean;
	indeterminate?: boolean;
	disabled?: boolean;
	onChange: ( checked: boolean ) => void;
	label: string;
} ) {
	const ref = useRef< HTMLInputElement >( null );

	useEffect( () => {
		if ( ref.current ) {
			ref.current.indeterminate = Boolean( indeterminate ) && ! checked;
		}
	}, [ checked, indeterminate ] );

	return (
		<input
			ref={ ref }
			type="checkbox"
			className={ styles.checkbox }
			checked={ checked }
			disabled={ disabled }
			aria-label={ label }
			onChange={ ( event ) => onChange( event.target.checked ) }
		/>
	);
}

function TreeItem( {
	node,
	level,
	index,
	siblingCount,
	disabled,
	onPatch,
	onExpand,
}: {
	node: TreeNode;
	level: number;
	index: number;
	siblingCount: number;
	disabled?: boolean;
	onPatch: ( id: string, patch: Partial< TreeNode > ) => void;
	onExpand?: ( node: TreeNode ) => Promise< void >;
} ) {
	const expanded = node.expanded ?? true;
	const canExpand = Boolean( node.children ) && ! node.hideExpandButton;

	return (
		<div>
			<div
				role="treeitem"
				aria-level={ level }
				aria-expanded={ node.children ? expanded : undefined }
				aria-setsize={ siblingCount }
				aria-posinset={ index + 1 }
				aria-checked={ node.indeterminate && ! node.checked ? 'mixed' : node.checked }
				aria-label={ node.label }
				className={ styles.item }
			>
				<button
					type="button"
					className={ clsx( styles.twisty, ! canExpand && styles.twistyHidden ) }
					aria-hidden={ ! canExpand }
					tabIndex={ canExpand ? 0 : -1 }
					aria-label={ expanded ? __( 'Collapse' ) : __( 'Expand' ) }
					onClick={ async () => {
						if ( ! canExpand ) {
							return;
						}
						// Children are fetched the first time a folder opens, not
						// up front: a site's wp-content is far too big to walk.
						if ( ! expanded && onExpand && node.children?.length === 0 ) {
							onPatch( node.id, { loading: true } );
							try {
								await onExpand( node );
							} finally {
								onPatch( node.id, { loading: false } );
							}
						}
						onPatch( node.id, { expanded: ! expanded } );
					} }
				>
					<Icon
						icon={ chevronRight }
						size={ 16 }
						className={ clsx( styles.twistyIcon, expanded && styles.twistyIconOpen ) }
						aria-hidden="true"
					/>
				</button>

				<label className={ clsx( styles.label, disabled && styles.labelDisabled ) }>
					<TriStateCheckbox
						checked={ node.checked }
						indeterminate={ node.indeterminate }
						disabled={ disabled }
						label={ node.label }
						onChange={ ( checked ) => onPatch( node.id, { checked } ) }
					/>
					{ node.type ? (
						<Icon
							icon={ NODE_ICONS[ node.type ] }
							size={ 16 }
							className={ styles.nodeIcon }
							aria-hidden="true"
						/>
					) : null }
					<span className={ styles.labelText }>{ node.label }</span>
				</label>

				{ node.loading ? <Spinner className={ styles.spinner } /> : null }
			</div>

			{ expanded && node.children ? (
				<div role="group" className={ styles.group }>
					{ node.children.length === 0 ? (
						<p className={ styles.empty }>{ node.loading ? __( 'Loading…' ) : __( 'Empty' ) }</p>
					) : (
						node.children.map( ( child, childIndex ) => (
							<TreeItem
								key={ child.id }
								node={ child }
								level={ level + 1 }
								index={ childIndex }
								siblingCount={ node.children?.length ?? 0 }
								disabled={ disabled }
								onPatch={ onPatch }
								onExpand={ onExpand }
							/>
						) )
					) }
				</div>
			) : null }
		</div>
	);
}

/**
 * The file tree behind "What to sync". Folders load their contents the first
 * time they're opened, and a folder's checkbox reflects its subtree — checked,
 * clear, or mixed.
 */
export function SyncTree( {
	tree,
	setTree,
	onExpand,
	disabled,
}: {
	tree: TreeNode[];
	setTree: Dispatch< SetStateAction< TreeNode[] > >;
	onExpand?: ( node: TreeNode ) => Promise< void >;
	disabled?: boolean;
} ) {
	return (
		<div role="tree" className={ styles.tree }>
			{ tree.map( ( node, index ) => (
				<TreeItem
					key={ node.id }
					node={ node }
					level={ 1 }
					index={ index }
					siblingCount={ tree.length }
					disabled={ disabled }
					onPatch={ ( id, patch ) => setTree( ( prev ) => updateNodeById( prev, id, patch ) ) }
					onExpand={ onExpand }
				/>
			) ) }
		</div>
	);
}
