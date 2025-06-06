import { CheckboxControl } from '@wordpress/components';
import { useState } from 'react';
import { FolderIcon } from 'src/components/icons/folder';
import { RightArrowIcon } from 'src/components/icons/right-arrow';
import { cx } from 'src/lib/cx';

export type TreeNode = {
	id: string;
	label: string;
	checked: boolean;
	indeterminate?: boolean;
	children?: TreeNode[];
	type?: 'folder';
};

const updateTree = ( nodes: TreeNode[], targetId: string, checked: boolean ): TreeNode[] => {
	return nodes.map( ( node ) => {
		if ( node.id === targetId ) {
			return {
				...node,
				checked,
				indeterminate: false,
				children: node.children ? updateAllChildren( node.children, checked ) : undefined,
			};
		} else if ( node.children ) {
			const updatedChildren = updateTree( node.children, targetId, checked );
			const { checked: parentChecked, indeterminate } =
				getParentStateFromChildren( updatedChildren );
			return {
				...node,
				checked: parentChecked,
				indeterminate,
				children: updatedChildren,
			};
		}
		return node;
	} );
};

const updateAllChildren = ( nodes: TreeNode[], checked: boolean ): TreeNode[] => {
	return nodes.map( ( node ) => ( {
		...node,
		checked,
		indeterminate: false,
		children: node.children ? updateAllChildren( node.children, checked ) : undefined,
	} ) );
};

const getParentStateFromChildren = (
	children: TreeNode[]
): { checked: boolean; indeterminate: boolean } => {
	const total = children.length;
	const checkedCount = children.filter( ( c ) => c.checked ).length;
	const indeterminateCount = children.filter( ( c ) => c.indeterminate ).length;

	if ( checkedCount === total ) {
		return { checked: true, indeterminate: false };
	}

	if ( checkedCount === 0 && indeterminateCount === 0 ) {
		return { checked: false, indeterminate: false };
	}

	return { checked: false, indeterminate: true };
};

const TreeItem = ( {
	node,
	onToggle,
	level,
}: {
	node: TreeNode;
	onToggle: ( id: string, checked: boolean ) => void;
	level: number;
} ) => {
	const [ expanded, setExpanded ] = useState( true );

	return (
		<div className={ cx( `treeItemLevel${ level }`, `treeItemId${ node.id }` ) }>
			<div className="flex items-center py-2">
				<CheckboxControl
					checked={ node.checked }
					indeterminate={ node.indeterminate }
					onChange={ ( checked: boolean ) => onToggle( node.id, checked ) }
					__nextHasNoMarginBottom
				/>
				{ node.type === 'folder' && <FolderIcon /> }
				<span>{ node.label }</span>
				{ node.children && (
					<button onClick={ () => setExpanded( ! expanded ) }>
						<div className={ expanded ? 'rotate-90' : '' }>
							<RightArrowIcon width={ 16 } />
						</div>
					</button>
				) }
			</div>
			{ expanded && node.children && (
				<div className="pl-6">
					{ node.children.map( ( child ) => (
						<TreeItem key={ child.id } node={ child } onToggle={ onToggle } level={ ++level } />
					) ) }
				</div>
			) }
		</div>
	);
};

export type TreeViewProps = {
	tree: TreeNode[];
	setTree: React.Dispatch< React.SetStateAction< TreeNode[] > >;
	className?: string;
};

export const TreeView = ( { tree, setTree, className }: TreeViewProps ) => {
	const handleToggle = ( id: string, checked: boolean ) => {
		setTree( ( prev: TreeNode[] ) => updateTree( prev, id, checked ) );
	};

	return (
		<div className={ className }>
			{ tree.map( ( node ) => (
				<TreeItem key={ node.id } node={ node } onToggle={ handleToggle } level={ 0 } />
			) ) }
		</div>
	);
};
