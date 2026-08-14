import { CheckboxControl, Icon, Spinner } from '@wordpress/components';
import { file, moreHorizontal, page, plugins, brush, cautionFilled } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import React from 'react';
import { RightArrowIcon } from '@/components/selective-sync/icons/right-arrow';
import { cx } from '@/components/selective-sync/lib/cx';

type TreeNodeType = 'folder' | 'file' | 'plugin' | 'theme' | 'more' | 'error';
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
	hasError?: boolean;
	pathId?: string;
	path?: string;
};

const TREE_NODE_ICONS: Record< TreeNodeType, React.JSX.Element > = {
	folder: file,
	file: page,
	plugin: plugins,
	theme: brush,
	more: moreHorizontal,
	error: cautionFilled,
};

const updateNode = ( node: TreeNode, partialNode: Partial< TreeNode > ): TreeNode => {
	const updatedNode = { ...node, ...partialNode };

	if ( updatedNode.children && updatedNode.children.length > 0 ) {
		updatedNode.children = updatedNode.children.map( ( child ) => {
			if ( 'checked' in partialNode ) {
				return updateNode( child, { checked: partialNode.checked } );
			}
			return child;
		} );

		const checkedCount = updatedNode.children.filter( ( c ) => c.checked ).length;
		const totalChildren = updatedNode.children.length;

		updatedNode.checked = checkedCount === totalChildren;
		updatedNode.indeterminate = checkedCount > 0 && checkedCount < totalChildren;
	}

	return updatedNode;
};

export const updateNodeById = (
	nodes: TreeNode[],
	id: string,
	partialNode: Partial< TreeNode >
): TreeNode[] => {
	return nodes.map( ( node ) => {
		if ( node.id === id ) {
			return updateNode( node, partialNode );
		}
		if ( node.children && node.children.length > 0 ) {
			const updatedChildren = updateNodeById( node.children, id, partialNode );
			const checkedCount = updatedChildren.filter( ( c ) => c.checked ).length;
			const totalChildren = updatedChildren.length;
			const anyIndeterminate = updatedChildren.some( ( c ) => c.indeterminate );

			return {
				...node,
				checked: checkedCount === totalChildren,
				indeterminate: ( checkedCount > 0 && checkedCount < totalChildren ) || anyIndeterminate,
				children: updatedChildren,
			};
		}
		return node;
	} );
};

const TreeItem = ( {
	node,
	onPatchNode,
	onExpand,
	level,
	index,
	siblingsLength,
	disabled,
	renderAfterChildren,
	renderEmptyContent,
}: {
	node: TreeNode;
	onPatchNode: ( id: string, patchNode: Partial< TreeNode > ) => void;
	onExpand?: ( node: TreeNode ) => Promise< void >;
	level: number;
	index: number;
	siblingsLength?: number;
	isLast?: boolean;
	disabled?: boolean;
	renderAfterChildren?: ( nodeId: string ) => React.ReactNode;
	renderEmptyContent?: ( nodeId: string, node: TreeNode ) => React.ReactNode;
} ) => {
	const { __ } = useI18n();
	const isFirstLevel = level === 1;
	const expanded = node.expanded ?? true;

	return (
		<div>
			<div
				role="treeitem"
				aria-level={ level }
				aria-expanded={ node.children ? expanded : undefined }
				aria-setsize={ siblingsLength }
				aria-posinset={ index + 1 }
				aria-checked={ node.indeterminate ? 'mixed' : node.checked }
				aria-label={ node.label }
				className={ cx( 'flex items-center py-2 relative gap-2', isFirstLevel && 'py-4' ) }
			>
				<label className={ cx( 'flex items-center', disabled && 'cursor-not-allowed opacity-60' ) }>
					<CheckboxControl
						id={ node.id }
						checked={ node.checked }
						indeterminate={ node.indeterminate }
						onChange={ ( checked: boolean ) => onPatchNode( node.id, { checked } ) }
						disabled={ disabled }
						__nextHasNoMarginBottom
					/>
					{ node.type && (
						<Icon
							aria-hidden
							icon={ TREE_NODE_ICONS[ node.type ] }
							size={ 20 }
							className="me-1.5 fill-frame-text"
						/>
					) }
					{ node.label }
				</label>
				{ node.loading && <Spinner className="!w-[9px] !h-[9px] !m-0" /> }
				{ ! node.loading && node.children && ! node.hideExpandButton && (
					<button
						aria-label={ expanded ? __( 'Collapse' ) : __( 'Expand' ) }
						onClick={ async () => {
							if (
								! expanded &&
								onExpand &&
								node.children?.length === 0 &&
								node.type === 'folder'
							) {
								onPatchNode( node.id, { loading: true } );
								try {
									await onExpand( node );
								} finally {
									onPatchNode( node.id, { loading: false } );
								}
							}
							onPatchNode( node.id, { expanded: ! expanded } );
						} }
					>
						<div className={ expanded ? 'rotate-90' : '' }>
							<RightArrowIcon width={ 16 } />
						</div>
					</button>
				) }
			</div>
			{ expanded && node.children && (
				<div
					role="group"
					className={ cx( 'ps-6', isFirstLevel && 'border border-frame-border rounded-sm py-2' ) }
				>
					{ node.children.length === 0 ? (
						renderEmptyContent ? (
							renderEmptyContent( node.id, node )
						) : (
							<div className="text-frame-text-secondary italic" aria-label={ __( 'Empty folder' ) }>
								{ __( 'Empty' ) }
							</div>
						)
					) : (
						node.children.map( ( child, idx ) => (
							<TreeItem
								key={ child.id }
								node={ child }
								onPatchNode={ onPatchNode }
								onExpand={ onExpand }
								level={ level + 1 }
								index={ idx }
								siblingsLength={ node.children?.length }
								renderAfterChildren={ renderAfterChildren }
								renderEmptyContent={ renderEmptyContent }
							/>
						) )
					) }
					{ renderAfterChildren && renderAfterChildren( node.id ) }
				</div>
			) }
		</div>
	);
};

type TreeViewProps = {
	tree: TreeNode[];
	setTree: React.Dispatch< React.SetStateAction< TreeNode[] > >;
	onExpand?: ( node: TreeNode ) => Promise< void >;
	disabled?: boolean;
	renderAfterChildren?: ( nodeId: string ) => React.ReactNode;
	renderEmptyContent?: ( nodeId: string, node: TreeNode ) => React.ReactNode;
};

export const TreeView = ( {
	tree,
	setTree,
	onExpand,
	disabled,
	renderAfterChildren,
	renderEmptyContent,
}: TreeViewProps ) => {
	const handlePatchNode = ( id: string, partialNode: Partial< TreeNode > ) => {
		setTree( ( prev: TreeNode[] ) => updateNodeById( prev, id, partialNode ) );
	};

	return (
		<div role="tree">
			{ tree.map( ( node, index ) => (
				<TreeItem
					key={ node.id }
					node={ node }
					onPatchNode={ handlePatchNode }
					onExpand={ onExpand }
					level={ 1 }
					index={ index }
					siblingsLength={ tree.length }
					isLast={ index === tree.length - 1 }
					disabled={ disabled }
					renderAfterChildren={ renderAfterChildren }
					renderEmptyContent={ renderEmptyContent }
				/>
			) ) }
		</div>
	);
};
