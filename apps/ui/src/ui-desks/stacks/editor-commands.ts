import {
	getIndicesAbove,
	sortByIndex,
	type Editor,
	type TLShape,
	type TLShapePartial,
} from 'tldraw';
import {
	clearExpandedStackMeta,
	clearStackMeta,
	clearStackPushMeta,
	createExpandedStackMeta,
	createStackId,
	createStackMeta,
	createStackPushMeta,
	getStackAnchorFromMember,
	getStackCircleLayoutsFromCenter,
	getStackConfiguredViewMode,
	getStackHome,
	getStackId,
	getStackMemberLayout,
	getStackOpenViewMode,
	getStackOrder,
	getStackOriginalZIndex,
	getStackPushOrigin,
	getStackTileLayoutsFromCenter,
	getStackViewMode,
	getStackZIndexFromMember,
	getWidgetIdFromShapeId,
	isStackExpanded,
	type StackViewMode,
} from './utils';

interface StackWidgetSelection {
	shapes: TLShape[];
	canStack: boolean;
	canUnstack: boolean;
	stackIds: string[];
}

const STACK_ANIMATION_DURATION = 240;
const EXPANDED_STACK_GAP = 100;
const STACK_DIM_OPACITY = 0.08;
const NEIGHBOR_GAP = 80;
const PUSH_THRESHOLD = 6;

export function stackSelectedWidgetsInEditor(
	editor: Editor,
	selection: StackWidgetSelection | null
) {
	if ( ! selection?.canStack ) {
		return false;
	}

	const orderedShapes = getStackOrderedShapes( selection.shapes );
	const memberIndices = getIndicesAbove(
		getHighestShapeIndex( editor.getCurrentPageShapes() ),
		orderedShapes.length
	);
	const stack = {
		id: createStackId(),
		x: selection.shapes[ 0 ].x,
		y: selection.shapes[ 0 ].y,
		zIndex: memberIndices[ memberIndices.length - 1 ],
		memberIds: orderedShapes.map( ( shape ) => getWidgetIdFromShapeId( shape.id ) ),
	};

	editor.animateShapes(
		orderedShapes.map( ( shape, order ) => ( {
			id: shape.id,
			type: shape.type,
			...getStackMemberLayout( stack, order ),
			index: memberIndices[ memberIndices.length - order - 1 ],
			meta: {
				...( shape.meta ?? {} ),
				...createStackMeta( stack.id, order, shape.index ),
			},
		} ) ),
		{ animation: { duration: STACK_ANIMATION_DURATION } }
	);
	return true;
}

export function expandStackInEditor( editor: Editor, stackId: string ) {
	const members = getStackMembers( editor, stackId );
	if (
		members.length <= 1 ||
		members.some( isStackExpanded ) ||
		getStackViewMode( members[ 0 ] ) !== 'stack'
	) {
		return false;
	}

	const stack = getStackFromCollapsedMembers( members );
	const expandedLayouts: Array< { x: number; y: number; rotation?: number } > =
		getStackOpenViewMode( members[ 0 ] ) === 'circle'
			? getStackCircleLayoutsFromCenter(
					members.map( getShapeSize ),
					getStackAnchorCenter( members )
			  )
			: getExpandedStackLayouts( members, stack );

	editor.updateShapes(
		members.map( ( shape ) => ( {
			id: shape.id,
			type: shape.type,
			isLocked: false,
			meta: {
				...( shape.meta ?? {} ),
				...createExpandedStackMeta( stack, getStackOrder( shape ) ),
			},
		} ) )
	);

	const expandedPartials = members.map( ( shape, index ) => ( {
		id: shape.id,
		type: shape.type,
		...expandedLayouts[ index ],
		rotation: expandedLayouts[ index ]?.rotation ?? 0,
	} ) );
	const expandedBounds = getPartialsBounds( expandedPartials, members );
	const pushPartials = getNeighborPushPartials( editor, stackId, expandedBounds );
	const partials = withStackDimPartials( editor, [ ...expandedPartials, ...pushPartials ] );

	editor.animateShapes( partials, { animation: { duration: STACK_ANIMATION_DURATION } } );
	return true;
}

export function collapseStackInEditor( editor: Editor, stackId: string ) {
	const members = getStackMembers( editor, stackId );
	if (
		members.length <= 1 ||
		! members.some( isStackExpanded ) ||
		getStackViewMode( members[ 0 ] ) !== 'stack'
	) {
		return false;
	}

	const stack = getStackFromExpandedMembers( members );
	editor.updateShapes(
		members.map( ( shape ) => ( {
			id: shape.id,
			type: shape.type,
			isLocked: false,
			meta: {
				...clearExpandedStackMeta(),
			},
		} ) )
	);

	const memberPartials = members.map( ( shape ) => {
		const order = getStackOrder( shape );
		return {
			id: shape.id,
			type: shape.type,
			...getStackMemberLayout( stack, order ),
		};
	} );
	const restorePartials = getNeighborRestorePartials( editor, stackId );
	const partials = withStackDimPartials( editor, [ ...memberPartials, ...restorePartials ] );

	editor.animateShapes( partials, { animation: { duration: STACK_ANIMATION_DURATION } } );
	return true;
}

export function collapseAllExpandedStacksInEditor( editor: Editor ) {
	let didCollapseStack = false;
	for ( const stackId of getExpandedStackIds( editor ) ) {
		didCollapseStack = collapseStackInEditor( editor, stackId ) || didCollapseStack;
	}
	return didCollapseStack;
}

export function setStackViewInEditor(
	editor: Editor,
	stackId: string,
	viewMode: StackViewMode,
	options: { anchorCenter?: { x: number; y: number } } = {}
) {
	const members = getStackMembers( editor, stackId );
	if ( members.length <= 1 ) {
		return false;
	}

	const currentViewMode = getStackConfiguredViewMode( members[ 0 ] );
	if ( currentViewMode === viewMode ) {
		return false;
	}

	const anchor = options.anchorCenter ?? getStackAnchorCenter( members );
	const restorePartials = getNeighborRestorePartials( editor, stackId );

	if ( viewMode === 'tiles' ) {
		editor.updateShapes(
			members.map( ( shape ) => ( {
				id: shape.id,
				type: shape.type,
				isLocked: false,
				meta: {
					...( shape.meta ?? {} ),
					...clearExpandedStackMeta(),
					deskStackViewMode: viewMode,
					deskStackOpenViewMode: null,
				},
			} ) )
		);

		const layoutPartials = getTiledStackPartials( members, anchor );
		editor.animateShapes(
			withStackDimPartials( editor, [ ...layoutPartials, ...restorePartials ] ),
			{
				animation: { duration: STACK_ANIMATION_DURATION },
			}
		);
		return true;
	}

	const stack = {
		id: stackId,
		x: anchor.x - getShapeSize( members[ 0 ] ).w / 2,
		y: anchor.y - getShapeSize( members[ 0 ] ).h / 2,
		zIndex: getStackZIndexFromMember( members[ 0 ].index, getStackOrder( members[ 0 ] ) ),
		memberIds: members.map( ( shape ) => getWidgetIdFromShapeId( shape.id ) ),
	};

	editor.updateShapes(
		members.map( ( shape ) => ( {
			id: shape.id,
			type: shape.type,
			isLocked: false,
			meta: {
				...( shape.meta ?? {} ),
				deskStackViewMode: null,
				deskStackOpenViewMode: viewMode === 'circle' ? 'circle' : null,
				...clearExpandedStackMeta(),
			},
		} ) )
	);

	const memberPartials = members.map( ( shape ) => {
		const order = getStackOrder( shape );
		return {
			id: shape.id,
			type: shape.type,
			...getStackMemberLayout( stack, order ),
		};
	} );

	editor.animateShapes( withStackDimPartials( editor, [ ...memberPartials, ...restorePartials ] ), {
		animation: { duration: STACK_ANIMATION_DURATION },
	} );
	return true;
}

export function unstackSelectedWidgetsInEditor(
	editor: Editor,
	selection: StackWidgetSelection | null
) {
	if ( ! selection?.canUnstack ) {
		return false;
	}

	const stackIds = new Set( selection.stackIds );
	const shapes = editor.getCurrentPageShapes().filter( ( shape ) => {
		const stackId = getStackId( shape );
		return stackId ? stackIds.has( stackId ) : false;
	} );

	if ( shapes.length === 0 ) {
		return false;
	}

	editor.updateShapes(
		shapes.map( ( shape ) => ( {
			id: shape.id,
			type: shape.type,
			isLocked: false,
			opacity: 1,
			rotation: 0,
			index: ( getStackOriginalZIndex( shape ) ?? shape.index ) as TLShapePartial[ 'index' ],
			meta: clearStackMeta(),
		} ) )
	);
	const restorePartials = Array.from( stackIds ).flatMap( ( stackId ) =>
		getNeighborRestorePartials( editor, stackId )
	);
	const partials = withStackDimPartials( editor, restorePartials );
	if ( partials.length > 0 ) {
		editor.animateShapes( partials, { animation: { duration: STACK_ANIMATION_DURATION } } );
	}
	editor.setSelectedShapes( shapes.map( ( shape ) => shape.id ) );
	return true;
}

function getStackOrderedShapes( shapes: TLShape[] ) {
	return [ ...shapes ].sort( ( first, second ) => sortByIndex( second, first ) );
}

function getStackMembers( editor: Editor, stackId: string ) {
	return editor
		.getCurrentPageShapes()
		.filter( ( shape ) => getStackId( shape ) === stackId )
		.sort( ( a, b ) => getStackOrder( a ) - getStackOrder( b ) );
}

function getExpandedStackIds( editor: Editor ) {
	const stackIds = new Set< string >();
	for ( const shape of editor.getCurrentPageShapes() ) {
		const stackId = getStackId( shape );
		if ( stackId && isStackExpanded( shape ) ) {
			stackIds.add( stackId );
		}
	}
	return stackIds;
}

function getStackFromCollapsedMembers( members: TLShape[] ) {
	const firstMember = members[ 0 ];
	const firstOrder = getStackOrder( firstMember );
	const anchor = getStackAnchorFromMember( firstMember, firstOrder, members.length );

	return {
		id: getStackId( firstMember ) ?? createStackId(),
		x: anchor.x,
		y: anchor.y,
		zIndex: getStackZIndexFromMember( firstMember.index, firstOrder ),
		memberIds: members.map( ( shape ) => getWidgetIdFromShapeId( shape.id ) ),
	};
}

function getStackFromExpandedMembers( members: TLShape[] ) {
	const firstMember = members[ 0 ];
	const home = getStackHome( firstMember );
	if ( home ) {
		return {
			id: getStackId( firstMember ) ?? createStackId(),
			x: home.x,
			y: home.y,
			zIndex: home.zIndex,
			memberIds: members.map( ( shape ) => getWidgetIdFromShapeId( shape.id ) ),
		};
	}

	return getStackFromCollapsedMembers( members );
}

function getExpandedStackLayouts( members: TLShape[], stack: { x: number; y: number } ) {
	const dimensions = getExpandedStackDimensions( members.length );
	const sizes = members.map( getShapeSize );
	const cellWidth = Math.max( ...sizes.map( ( size ) => size.w ) );
	const cellHeight = Math.max( ...sizes.map( ( size ) => size.h ) );
	const totalWidth =
		dimensions.columns * cellWidth + ( dimensions.columns - 1 ) * EXPANDED_STACK_GAP;
	const totalHeight = dimensions.rows * cellHeight + ( dimensions.rows - 1 ) * EXPANDED_STACK_GAP;
	const firstSize = sizes[ 0 ];
	const anchorCenter = {
		x: stack.x + firstSize.w / 2,
		y: stack.y + firstSize.h / 2,
	};
	const startX = anchorCenter.x - totalWidth / 2;
	const startY = anchorCenter.y - totalHeight / 2;

	return members.map( ( _shape, index ) => {
		const column = index % dimensions.columns;
		const row = Math.floor( index / dimensions.columns );
		const size = sizes[ index ];

		return {
			x: startX + column * ( cellWidth + EXPANDED_STACK_GAP ) + ( cellWidth - size.w ) / 2,
			y: startY + row * ( cellHeight + EXPANDED_STACK_GAP ) + ( cellHeight - size.h ) / 2,
		};
	} );
}

function getStackAnchorCenter( members: TLShape[] ) {
	const firstMember = members[ 0 ];
	const size = getShapeSize( firstMember );

	return {
		x: firstMember.x + size.w / 2,
		y: firstMember.y + size.h / 2,
	};
}

function getTiledStackPartials( members: TLShape[], center: { x: number; y: number } ) {
	const layouts = getStackTileLayoutsFromCenter( members.map( getShapeSize ), center );

	return members.map( ( shape, index ) => ( {
		id: shape.id,
		type: shape.type,
		...layouts[ index ],
	} ) );
}

function getExpandedStackDimensions( count: number ) {
	if ( count <= 5 ) {
		return {
			rows: 1,
			columns: Math.max( 1, count ),
		};
	}

	return {
		rows: 2,
		columns: Math.ceil( count / 2 ),
	};
}

function getShapeSize( shape: TLShape ) {
	const shapeProps = ( shape.props as { shapeProps?: { w?: unknown; h?: unknown } } ).shapeProps;

	return {
		w: typeof shapeProps?.w === 'number' ? shapeProps.w : 100,
		h: typeof shapeProps?.h === 'number' ? shapeProps.h : 100,
	};
}

interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

function getPartialsBounds( partials: TLShapePartial[], shapes: TLShape[] ): Bounds {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for ( let index = 0; index < partials.length; index++ ) {
		const partial = partials[ index ];
		const shape = shapes[ index ];
		if ( ! shape || typeof partial.x !== 'number' || typeof partial.y !== 'number' ) {
			continue;
		}

		const size = getShapeSize( shape );
		minX = Math.min( minX, partial.x );
		minY = Math.min( minY, partial.y );
		maxX = Math.max( maxX, partial.x + size.w );
		maxY = Math.max( maxY, partial.y + size.h );
	}

	return { minX, minY, maxX, maxY };
}

function getNeighborPushPartials( editor: Editor, stackId: string, expandedBounds: Bounds ) {
	if ( ! Number.isFinite( expandedBounds.minX ) ) {
		return [];
	}

	const memberIds = new Set( getStackMembers( editor, stackId ).map( ( member ) => member.id ) );
	const expandedCenter = {
		x: ( expandedBounds.minX + expandedBounds.maxX ) / 2,
		y: ( expandedBounds.minY + expandedBounds.maxY ) / 2,
	};
	const expandedHalfWidth = ( expandedBounds.maxX - expandedBounds.minX ) / 2;
	const expandedHalfHeight = ( expandedBounds.maxY - expandedBounds.minY ) / 2;
	const decayLength = Math.max( expandedHalfWidth, expandedHalfHeight ) * 0.35;
	const partials: TLShapePartial[] = [];

	for ( const shape of editor.getCurrentPageShapes() ) {
		if ( memberIds.has( shape.id ) ) {
			continue;
		}

		const bounds = editor.getShapePageBounds( shape.id );
		if ( ! bounds ) {
			continue;
		}

		const deltaX = bounds.center.x - expandedCenter.x;
		const deltaY = bounds.center.y - expandedCenter.y;
		const distance = Math.hypot( deltaX, deltaY );
		const directionX = distance === 0 ? 1 : deltaX / distance;
		const directionY = distance === 0 ? 0 : deltaY / distance;
		const shapeHalfWidth = ( bounds.maxX - bounds.minX ) / 2;
		const shapeHalfHeight = ( bounds.maxY - bounds.minY ) / 2;
		const requiredDistance = Math.max(
			expandedHalfWidth + shapeHalfWidth + NEIGHBOR_GAP,
			expandedHalfHeight + shapeHalfHeight + NEIGHBOR_GAP
		);
		const overlapPush = Math.max( 0, requiredDistance - distance );
		const distanceFromEdge = Math.max( 0, distance - requiredDistance );
		const sympathyPush =
			NEIGHBOR_GAP * 0.75 * Math.exp( -distanceFromEdge / Math.max( 1, decayLength ) );
		const pushAmount = Math.max( overlapPush, sympathyPush );

		if ( pushAmount < PUSH_THRESHOLD ) {
			continue;
		}

		partials.push( {
			id: shape.id,
			type: shape.type,
			x: shape.x + directionX * pushAmount,
			y: shape.y + directionY * pushAmount,
			meta: {
				...( shape.meta ?? {} ),
				...createStackPushMeta( stackId, shape ),
			},
		} );
	}

	return partials;
}

function getNeighborRestorePartials( editor: Editor, stackId: string ) {
	const partials: TLShapePartial[] = [];

	for ( const shape of editor.getCurrentPageShapes() ) {
		const pushOrigin = getStackPushOrigin( shape );
		if ( ! pushOrigin || pushOrigin.stackId !== stackId ) {
			continue;
		}

		partials.push( {
			id: shape.id,
			type: shape.type,
			x: pushOrigin.x,
			y: pushOrigin.y,
			meta: clearStackPushMeta(),
		} );
	}

	return partials;
}

function withStackDimPartials( editor: Editor, basePartials: TLShapePartial[] ) {
	const focusedShapeIds = new Set< TLShape[ 'id' ] >();
	let hasExpandedStack = false;

	for ( const shape of editor.getCurrentPageShapes() ) {
		if ( ! isStackExpanded( shape ) ) {
			continue;
		}

		focusedShapeIds.add( shape.id );
		hasExpandedStack = true;
	}

	const partialsById = new Map< TLShape[ 'id' ], TLShapePartial >();
	for ( const partial of basePartials ) {
		partialsById.set( partial.id, partial );
	}

	for ( const shape of editor.getCurrentPageShapes() ) {
		const isFocused = ! hasExpandedStack || focusedShapeIds.has( shape.id );
		const targetOpacity = isFocused ? 1 : STACK_DIM_OPACITY;
		const targetLocked = ! isFocused;
		const shouldUpdateOpacity = Math.abs( shape.opacity - targetOpacity ) > 0.001;
		const shouldUpdateLock = shape.isLocked !== targetLocked;

		if ( ! shouldUpdateOpacity && ! shouldUpdateLock ) {
			continue;
		}

		const partial = partialsById.get( shape.id ) ?? {
			id: shape.id,
			type: shape.type,
		};

		if ( shouldUpdateOpacity ) {
			partial.opacity = targetOpacity;
		}
		if ( shouldUpdateLock ) {
			partial.isLocked = targetLocked;
		}

		partialsById.set( shape.id, partial );
	}

	return Array.from( partialsById.values() );
}

function getHighestShapeIndex( shapes: Pick< TLShape, 'index' >[] ) {
	return [ ...shapes ].sort( sortByIndex ).at( -1 )?.index;
}
