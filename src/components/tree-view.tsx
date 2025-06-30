import { CheckboxControl, Icon, Spinner } from '@wordpress/components';
import { file, page } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import React from 'react';
import { RightArrowIcon } from 'src/components/icons/right-arrow';
import { cx } from 'src/lib/cx';

type TreeNodeType = 'folder' | 'file';
export type TreeNode = {
	id: string;
	label: string;
	checked: boolean;
	indeterminate?: boolean;
	expanded?: boolean;
	hideExpandButton?: boolean;
	children?: TreeNode[];
	type?: TreeNodeType;
	loading?: boolean;
};

const TREE_NODE_ICONS: Record< TreeNodeType, React.JSX.Element > = {
	folder: file,
	file: page,
};

const updateNode = ( node: TreeNode, partialNode: Partial< TreeNode > ): TreeNode => {
	const updatedNode = { ...node, ...partialNode };

	if ( updatedNode.children ) {
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
		if ( node.children ) {
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
	level,
	index,
	isLast = false,
	siblingsLength,
}: {
	node: TreeNode;
	onPatchNode: ( id: string, patchNode: Partial< TreeNode > ) => void;
	level: number;
	index: number;
	siblingsLength?: number;
	isLast?: boolean;
} ) => {
	const { __ } = useI18n();
	const isLevel0 = level === 0;
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
				className={ cx(
					'flex items-center py-2 relative gap-2',
					isLevel0 ? 'border-b border-gray-300 py-4' : '',
					isLast ? 'border-white' : ''
				) }
			>
				<div className="flex items-center cursor-pointer">
					<CheckboxControl
						id={ node.id }
						checked={ node.checked }
						indeterminate={ node.indeterminate }
						onChange={ ( checked: boolean ) => onPatchNode( node.id, { checked } ) }
						__nextHasNoMarginBottom
					/>
					{ node.type && (
						<Icon
							aria-hidden
							icon={ TREE_NODE_ICONS[ node.type ] }
							size={ 20 }
							className="me-1.5"
						/>
					) }
					<label htmlFor={ node.id }>{ node.label }</label>
				</div>
				{ node.loading && <Spinner className="!w-[9px] !h-[9px] !m-0" /> }
				{ ! node.loading && node.children && ! node.hideExpandButton && (
					<button
						aria-label={ expanded ? __( 'Collapse' ) : __( 'Expand' ) }
						onClick={ () => onPatchNode( node.id, { expanded: ! expanded } ) }
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
					className={ cx( 'ps-6', isLevel0 ? 'border-b border-gray-300 py-2' : '' ) }
				>
					{ node.children.map( ( child, idx ) => (
						<TreeItem
							key={ child.id }
							node={ child }
							onPatchNode={ onPatchNode }
							level={ level + 1 }
							index={ idx }
							siblingsLength={ node.children?.length }
						/>
					) ) }
				</div>
			) }
		</div>
	);
};

export type TreeViewProps = {
	tree: TreeNode[];
	setTree: React.Dispatch< React.SetStateAction< TreeNode[] > >;
};

export const TreeView = ( { tree, setTree }: TreeViewProps ) => {
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
					level={ 1 }
					index={ index }
					siblingsLength={ tree.length }
					isLast={ index === tree.length - 1 }
				/>
			) ) }
		</div>
	);
};
