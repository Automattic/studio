import { CheckboxControl, Icon, Spinner } from '@wordpress/components';
import { file, page } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useRef, useState, useEffect } from 'react';
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
	isLast,
	index = 0,
	setsize = 1,
	focusedId,
	setFocusedId,
	nodeRefs,
	visibleNodeIds,
}: {
	node: TreeNode;
	onPatchNode: ( id: string, patchNode: Partial< TreeNode > ) => void;
	level: number;
	isLast?: boolean;
	index?: number;
	setsize?: number;
	focusedId: string;
	setFocusedId: ( id: string ) => void;
	nodeRefs: Record< string, React.RefObject< HTMLDivElement > >;
	visibleNodeIds: string[];
} ) => {
	const { __ } = useI18n();
	const isLevel0 = level === 0;
	const expanded = node.expanded ?? true;
	const ref = useRef< HTMLDivElement >( null );
	const isFocused = focusedId === node.id;

	useEffect( () => {
		nodeRefs[ node.id ] = ref;
	}, [ node.id, nodeRefs ] );

	const getNextNodeId = ( key: string, currentIndex: number ): string | null => {
		const navigationMap: Record< string, () => string | null > = {
			ArrowDown: () =>
				currentIndex < visibleNodeIds.length - 1 ? visibleNodeIds[ currentIndex + 1 ] : null,
			ArrowUp: () => ( currentIndex > 0 ? visibleNodeIds[ currentIndex - 1 ] : null ),
			Home: () => visibleNodeIds[ 0 ],
			End: () => visibleNodeIds[ visibleNodeIds.length - 1 ],
		};

		return navigationMap[ key ]?.() ?? null;
	};

	const navigateToNode = ( nodeId: string ) => {
		setFocusedId( nodeId );
		setTimeout( () => {
			nodeRefs[ nodeId ]?.current?.focus();
		}, 0 );
	};

	const handleKeyDown = ( e: React.KeyboardEvent< HTMLDivElement > ) => {
		const currentIndex = visibleNodeIds.indexOf( node.id );
		if ( currentIndex === -1 ) return;

		if ( e.key === ' ' || e.key === 'Enter' ) {
			e.preventDefault();
			onPatchNode( node.id, { checked: ! node.checked } );
			return;
		}

		if ( e.key === 'ArrowRight' ) {
			e.preventDefault();
			if ( node.children && ! expanded ) {
				onPatchNode( node.id, { expanded: true } );
			}
			return;
		}

		if ( e.key === 'ArrowLeft' ) {
			e.preventDefault();
			if ( node.children && expanded ) {
				onPatchNode( node.id, { expanded: false } );
			}
			return;
		}

		const nextNodeId = getNextNodeId( e.key, currentIndex );
		if ( nextNodeId ) {
			e.preventDefault();
			navigateToNode( nextNodeId );
		}
	};

	return (
		<div>
			<div
				role="treeitem"
				aria-level={ level }
				aria-expanded={ node.children ? expanded : undefined }
				aria-setsize={ setsize }
				aria-posinset={ index + 1 }
				tabIndex={ isFocused ? 0 : -1 }
				ref={ ref }
				onFocus={ () => setFocusedId( node.id ) }
				onKeyDown={ handleKeyDown }
				className={ cx(
					'flex items-center py-2 relative gap-2',
					isLevel0 ? 'border-b border-gray-300 py-4' : '',
					isLast ? 'border-white' : ''
				) }
			>
				<label className="flex items-center cursor-pointer">
					<CheckboxControl
						id={ node.id }
						checked={ node.checked }
						indeterminate={ node.indeterminate }
						onChange={ ( checked: boolean ) => onPatchNode( node.id, { checked } ) }
						__nextHasNoMarginBottom
						aria-label={ node.label }
					/>
					{ node.type && (
						<Icon
							aria-hidden
							icon={ TREE_NODE_ICONS[ node.type ] }
							size={ 20 }
							className="me-1.5"
						/>
					) }
					<span aria-hidden>{ node.label }</span>
				</label>
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
					{ node.children &&
						node.children.map( ( child, idx ) => (
							<TreeItem
								key={ child.id }
								node={ child }
								onPatchNode={ onPatchNode }
								level={ level + 1 }
								index={ idx }
								setsize={ node.children ? node.children.length : 0 }
								focusedId={ focusedId }
								setFocusedId={ setFocusedId }
								nodeRefs={ nodeRefs }
								visibleNodeIds={ visibleNodeIds }
							/>
						) ) }
				</div>
			) }
		</div>
	);
};

function flattenVisibleTree( nodes: TreeNode[], result: string[] = [] ): string[] {
	for ( const node of nodes ) {
		result.push( node.id );
		if ( node.children && ( node.expanded ?? true ) ) {
			flattenVisibleTree( node.children, result );
		}
	}
	return result;
}

export type TreeViewProps = {
	tree: TreeNode[];
	setTree: React.Dispatch< React.SetStateAction< TreeNode[] > >;
};

export const TreeView = ( { tree, setTree }: TreeViewProps ) => {
	const [ focusedId, setFocusedId ] = useState( tree[ 0 ]?.id || '' );
	const nodeRefs = {} as Record< string, React.RefObject< HTMLDivElement > >;
	const visibleNodeIds = flattenVisibleTree( tree );
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
					setsize={ tree.length }
					isLast={ index === tree.length - 1 }
					focusedId={ focusedId }
					setFocusedId={ setFocusedId }
					nodeRefs={ nodeRefs }
					visibleNodeIds={ visibleNodeIds }
				/>
			) ) }
		</div>
	);
};
