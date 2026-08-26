import { cursorHide } from '@inquirer/ansi';
import {
	createPrompt,
	useState,
	useKeypress,
	usePrefix,
	usePagination,
	makeTheme,
	isUpKey,
	isDownKey,
	isSpaceKey,
	isEnterKey,
} from '@inquirer/core';
import figures from '@inquirer/figures';
import chalk from '@studio/common/lib/chalk';
import { __, sprintf } from '@wordpress/i18n';

export type TreeNode = {
	name: string;
	value: string;
	isDirectory: boolean;
	checked: boolean;
	indeterminate?: boolean;
	expanded: boolean;
	depth: number;
	children?: TreeNode[];
	loading?: boolean;
	pathId?: string;
};

type TreeCheckboxConfig = {
	message: string;
	tree: TreeNode[];
	onExpand?: ( node: TreeNode ) => Promise< TreeNode[] >;
	pageSize?: number;
};

type FlatItem = {
	node: TreeNode;
	path: number[];
};

function flattenTree( nodes: TreeNode[], path: number[] = [] ): FlatItem[] {
	const result: FlatItem[] = [];
	for ( let i = 0; i < nodes.length; i++ ) {
		const currentPath = [ ...path, i ];
		result.push( { node: nodes[ i ], path: currentPath } );
		if ( nodes[ i ].expanded && nodes[ i ].children?.length ) {
			result.push( ...flattenTree( nodes[ i ].children!, currentPath ) );
		}
	}
	return result;
}

function updateNodeAtPath(
	tree: TreeNode[],
	path: number[],
	updater: ( node: TreeNode ) => TreeNode
): TreeNode[] {
	const newTree = [ ...tree ];
	if ( path.length === 1 ) {
		newTree[ path[ 0 ] ] = updater( newTree[ path[ 0 ] ] );
		return newTree;
	}
	newTree[ path[ 0 ] ] = {
		...newTree[ path[ 0 ] ],
		children: updateNodeAtPath( newTree[ path[ 0 ] ].children || [], path.slice( 1 ), updater ),
	};
	return newTree;
}

function setCheckedRecursive( node: TreeNode, checked: boolean ): TreeNode {
	return {
		...node,
		checked,
		children: node.children?.map( ( child ) => setCheckedRecursive( child, checked ) ),
	};
}

function propagateCheckedState( nodes: TreeNode[] ): TreeNode[] {
	return nodes.map( ( node ) => {
		if ( ! node.children?.length ) {
			return { ...node, indeterminate: false };
		}

		const updatedChildren = propagateCheckedState( node.children );
		const allChecked = updatedChildren.every( ( c ) => c.checked );
		const noneChecked = updatedChildren.every( ( c ) => ! c.checked && ! c.indeterminate );

		return {
			...node,
			children: updatedChildren,
			checked: allChecked,
			indeterminate: ! allChecked && ! noneChecked,
		};
	} );
}

function collectCheckedValues( nodes: TreeNode[] ): TreeNode[] {
	const result: TreeNode[] = [];
	for ( const node of nodes ) {
		if ( node.checked ) {
			result.push( node );
		}
		if ( node.children?.length ) {
			result.push( ...collectCheckedValues( node.children ) );
		}
	}
	return result;
}

const treeTheme = {
	icon: {
		checked: chalk.green( figures.circleFilled ),
		unchecked: figures.circle,
		cursor: figures.pointer,
		expanded: '▾',
		collapsed: '▸',
	},
	style: {
		renderSelectedChoices: ( selectedChoices: TreeNode[] ) =>
			selectedChoices.map( ( c ) => c.name ).join( ', ' ),
	},
};

export default createPrompt< TreeNode[], TreeCheckboxConfig >( ( config, done ) => {
	const { pageSize = 15, onExpand } = config;
	const theme = makeTheme( treeTheme, {} );
	const [ status, setStatus ] = useState< 'idle' | 'loading' | 'done' >( 'idle' );
	const prefix = usePrefix( { status: status === 'loading' ? 'loading' : status, theme } );
	const [ tree, setTree ] = useState< TreeNode[] >( config.tree );
	const [ active, setActive ] = useState( 0 );

	const flatItems = flattenTree( tree );

	useKeypress( async ( key ) => {
		if ( status === 'loading' ) {
			return;
		}

		if ( key.name === 'escape' ) {
			setStatus( 'done' );
			done( [] );
			return;
		}

		if ( isEnterKey( key ) ) {
			setStatus( 'done' );
			done( collectCheckedValues( tree ) );
			return;
		}

		if ( isUpKey( key ) || isDownKey( key ) ) {
			const offset = isUpKey( key ) ? -1 : 1;
			const next = Math.max( 0, Math.min( flatItems.length - 1, active + offset ) );
			setActive( next );
			return;
		}

		if ( isSpaceKey( key ) ) {
			const item = flatItems[ active ];
			if ( ! item ) {
				return;
			}
			const toggled = updateNodeAtPath( tree, item.path, ( node ) =>
				setCheckedRecursive( node, ! node.checked )
			);
			setTree( propagateCheckedState( toggled ) );
			return;
		}

		// Right arrow: expand folder
		if ( key.name === 'right' ) {
			const item = flatItems[ active ];
			if ( ! item || ! item.node.isDirectory ) {
				return;
			}

			if ( item.node.expanded ) {
				return; // already expanded
			}

			if ( item.node.children && item.node.children.length > 0 ) {
				// Already has children, just expand
				const newTree = updateNodeAtPath( tree, item.path, ( node ) => ( {
					...node,
					expanded: true,
				} ) );
				setTree( newTree );
				return;
			}

			if ( onExpand ) {
				setStatus( 'loading' );
				const newTree = updateNodeAtPath( tree, item.path, ( node ) => ( {
					...node,
					loading: true,
				} ) );
				setTree( newTree );

				try {
					const children = await onExpand( item.node );
					const updatedTree = updateNodeAtPath( tree, item.path, ( node ) => ( {
						...node,
						expanded: true,
						loading: false,
						children: children.map( ( child ) => ( {
							...child,
							checked: node.checked,
						} ) ),
					} ) );
					setTree( updatedTree );
				} catch {
					const updatedTree = updateNodeAtPath( tree, item.path, ( node ) => ( {
						...node,
						loading: false,
					} ) );
					setTree( updatedTree );
				}
				setStatus( 'idle' );
			}
			return;
		}

		// Left arrow: collapse folder
		if ( key.name === 'left' ) {
			const item = flatItems[ active ];
			if ( ! item ) {
				return;
			}

			if ( item.node.isDirectory && item.node.expanded ) {
				const newTree = updateNodeAtPath( tree, item.path, ( node ) => ( {
					...node,
					expanded: false,
				} ) );
				setTree( newTree );
				return;
			}

			// If on a child, move cursor to parent
			if ( item.path.length > 1 ) {
				const parentPath = item.path.slice( 0, -1 );
				const parentIndex = flatItems.findIndex(
					( fi ) =>
						fi.path.length === parentPath.length &&
						fi.path.every( ( v, i ) => v === parentPath[ i ] )
				);
				if ( parentIndex >= 0 ) {
					setActive( parentIndex );
				}
			}
			return;
		}

		// 'a' to toggle all
		if ( key.name === 'a' ) {
			const anyUnchecked = flatItems.some( ( item ) => ! item.node.checked );
			const newTree = tree.map( ( node ) => setCheckedRecursive( node, anyUnchecked ) );
			setTree( newTree );
		}
	} );

	const message = theme.style.message( config.message, status );

	if ( status === 'done' ) {
		const selected = collectCheckedValues( tree );
		const summary =
			selected.length > 3
				? sprintf( __( '%d items selected' ), selected.length )
				: selected.map( ( n ) => n.name ).join( ', ' );
		return `${ prefix } ${ message } ${ chalk.cyan( summary ) }`;
	}

	const page = usePagination( {
		items: flatItems,
		active,
		renderItem: ( { item, isActive }: { item: FlatItem; isActive: boolean } ) => {
			const { node } = item;
			const indent = '  '.repeat( node.depth );
			const cursor = isActive ? chalk.cyan( figures.pointer ) : ' ';
			let check = figures.circle;
			if ( node.checked ) {
				check = chalk.green( figures.circleFilled );
			} else if ( node.indeterminate ) {
				check = chalk.yellow( '◐' );
			}

			let icon = '';
			if ( node.isDirectory ) {
				if ( node.loading ) {
					icon = chalk.yellow( '⟳ ' );
				} else if ( node.expanded ) {
					icon = '▾ ';
				} else {
					icon = '▸ ';
				}
			}

			const label = isActive ? chalk.cyan( node.name ) : node.name;
			return `${ cursor } ${ indent }${ check } ${ icon }${ label }`;
		},
		pageSize,
		loop: false,
	} );

	const helpTip = chalk.dim(
		[
			__( '↑↓ navigate' ),
			__( 'space toggle' ),
			__( '→← expand/collapse' ),
			__( 'a all' ),
			__( '⏎ confirm' ),
			__( 'esc cancel' ),
		].join( ' · ' )
	);

	return `${ prefix } ${ message }${ cursorHide }\n${ page }\n\n${ helpTip }`;
} );
