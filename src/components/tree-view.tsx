import { CheckboxControl } from '@wordpress/components';
import { FolderIcon } from 'src/components/icons/folder';
import { RightArrowIcon } from 'src/components/icons/right-arrow';
import { cx } from 'src/lib/cx';

export type TreeNode = {
	id: string;
	label: string;
	checked: boolean;
	indeterminate?: boolean;
	expanded?: boolean;
	children?: TreeNode[];
	disableExpand?: boolean;
	type?: 'folder';
};

const updateNode = ( node: TreeNode, updates: Partial< TreeNode > ): TreeNode => {
	const updatedNode = { ...node, ...updates };

	if ( node.children ) {
		updatedNode.children = node.children.map( ( child ) => {
			if ( 'checked' in updates ) {
				return updateNode( child, { checked: updates.checked } );
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

const updateNodeById = (
	nodes: TreeNode[],
	id: string,
	updates: Partial< TreeNode >
): TreeNode[] => {
	return nodes.map( ( node ) => {
		if ( node.id === id ) {
			return updateNode( node, updates );
		}
		if ( node.children ) {
			const updatedChildren = updateNodeById( node.children, id, updates );
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
	onToggle,
	onExpand,
	level,
	isLast,
}: {
	node: TreeNode;
	onToggle: ( id: string, checked: boolean ) => void;
	onExpand: ( id: string, expanded: boolean ) => void;
	level: number;
	isLast?: boolean;
} ) => {
	const isLevel0 = level === 0;

	return (
		<div>
			<div
				className={ cx(
					'flex items-center py-2 relative',
					isLevel0 ? 'border-b border-gray-300 py-4' : '',
					isLast ? 'border-white' : ''
				) }
			>
				<label className="flex items-center cursor-pointer">
					<CheckboxControl
						checked={ node.checked }
						indeterminate={ node.indeterminate }
						onChange={ ( checked: boolean ) => onToggle( node.id, checked ) }
						__nextHasNoMarginBottom
					/>
					{ node.type === 'folder' && <FolderIcon /> }
					<span>{ node.label }</span>
				</label>
				{ node.children && ! node.disableExpand && (
					<button onClick={ () => onExpand( node.id, ! node.expanded ) }>
						<div className={ node.expanded ? 'rotate-90' : '' }>
							<RightArrowIcon width={ 16 } />
						</div>
					</button>
				) }
			</div>
			{ node.expanded && node.children && (
				<div className={ cx( 'ps-6', isLevel0 ? 'border-b border-gray-300 py-2' : '' ) }>
					{ node.children.map( ( child ) => (
						<TreeItem
							key={ child.id }
							node={ child }
							onToggle={ onToggle }
							onExpand={ onExpand }
							level={ ++level }
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
	return (
		<div>
			{ tree.map( ( node, index ) => (
				<TreeItem
					key={ node.id }
					node={ node }
					onToggle={ ( id, checked ) =>
						setTree( ( prev ) => updateNodeById( prev, id, { checked } ) )
					}
					onExpand={ ( id, expanded ) =>
						setTree( ( prev ) => updateNodeById( prev, id, { expanded } ) )
					}
					level={ 0 }
					isLast={ index === tree.length - 1 }
				/>
			) ) }
		</div>
	);
};
