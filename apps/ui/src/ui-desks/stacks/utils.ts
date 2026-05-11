import { getIndicesAbove, getIndicesBelow, type TLShape, type TLShapePartial } from 'tldraw';
import type { DeskStack } from '@/ui-desks/desk/types';

export const STACK_TRANSLATE_X = 10;
export const STACK_TRANSLATE_Y = 8;
export const STACK_ROTATION = 0.052;
const STACK_Z_INDEX_STEP = 0.001;

export interface DeskStackShapeMeta {
	deskStackId?: unknown;
	deskStackOrder?: unknown;
	deskStackExpanded?: unknown;
	deskStackHomeX?: unknown;
	deskStackHomeY?: unknown;
	deskStackHomeZIndex?: unknown;
	deskStackOriginalZIndex?: unknown;
	deskStackPushedBy?: unknown;
	deskStackPushOriginX?: unknown;
	deskStackPushOriginY?: unknown;
}

export function getStackId( shape: TLShape | null | undefined ) {
	const meta = shape?.meta as DeskStackShapeMeta | undefined;
	return typeof meta?.deskStackId === 'string' ? meta.deskStackId : null;
}

export function getStackOrder( shape: TLShape | null | undefined ) {
	const meta = shape?.meta as DeskStackShapeMeta | undefined;
	const order = meta?.deskStackOrder;
	return typeof order === 'number' && Number.isInteger( order ) && order >= 0 ? order : 0;
}

export function isStackExpanded( shape: TLShape | null | undefined ) {
	const meta = shape?.meta as DeskStackShapeMeta | undefined;
	return meta?.deskStackExpanded === true;
}

export function getStackHome( shape: TLShape | null | undefined ) {
	const meta = shape?.meta as DeskStackShapeMeta | undefined;
	if (
		typeof meta?.deskStackHomeX !== 'number' ||
		typeof meta.deskStackHomeY !== 'number' ||
		typeof meta.deskStackHomeZIndex !== 'string'
	) {
		return null;
	}

	return {
		x: meta.deskStackHomeX,
		y: meta.deskStackHomeY,
		zIndex: meta.deskStackHomeZIndex,
	};
}

export function getStackPushOrigin( shape: TLShape | null | undefined ) {
	const meta = shape?.meta as DeskStackShapeMeta | undefined;
	if (
		typeof meta?.deskStackPushedBy !== 'string' ||
		typeof meta.deskStackPushOriginX !== 'number' ||
		typeof meta.deskStackPushOriginY !== 'number'
	) {
		return null;
	}

	return {
		stackId: meta.deskStackPushedBy,
		x: meta.deskStackPushOriginX,
		y: meta.deskStackPushOriginY,
	};
}

export function getStackOriginalZIndex( shape: TLShape | null | undefined ) {
	const meta = shape?.meta as DeskStackShapeMeta | undefined;
	return typeof meta?.deskStackOriginalZIndex === 'string' ? meta.deskStackOriginalZIndex : null;
}

export function getStackMemberLayout( stack: Pick< DeskStack, 'x' | 'y' >, order: number ) {
	return {
		x: stack.x + order * STACK_TRANSLATE_X,
		y: stack.y + order * STACK_TRANSLATE_Y,
		rotation: order * STACK_ROTATION,
	};
}

export function getStackAnchorFromMember( shape: Pick< TLShape, 'x' | 'y' >, order: number ) {
	return {
		x: shape.x - order * STACK_TRANSLATE_X,
		y: shape.y - order * STACK_TRANSLATE_Y,
	};
}

export function getStackMemberZIndex( zIndex: string, order: number ) {
	const numericIndex = parseDeskZIndex( zIndex );
	if ( numericIndex === null ) {
		if ( order === 0 ) {
			return zIndex as TLShapePartial[ 'index' ];
		}

		return (
			getIndicesBelow( zIndex as TLShapePartial[ 'index' ], order ).at( 0 ) ??
			( zIndex as TLShapePartial[ 'index' ] )
		);
	}

	return formatDeskZIndex( numericIndex - order * STACK_Z_INDEX_STEP ) as TLShapePartial[ 'index' ];
}

export function getStackZIndexFromMember( zIndex: string, order: number ) {
	const numericIndex = parseDeskZIndex( zIndex );
	if ( numericIndex === null ) {
		if ( order === 0 ) {
			return zIndex;
		}

		return getIndicesAbove( zIndex as TLShapePartial[ 'index' ], order ).at( -1 ) ?? zIndex;
	}

	return formatDeskZIndex( numericIndex + order * STACK_Z_INDEX_STEP );
}

export function createStackMeta( stackId: string, order: number, originalZIndex?: string ) {
	return {
		deskStackId: stackId,
		deskStackOrder: order,
		...( originalZIndex ? { deskStackOriginalZIndex: originalZIndex } : {} ),
	};
}

export function createExpandedStackMeta( stack: DeskStack, order: number ) {
	return {
		deskStackId: stack.id,
		deskStackOrder: order,
		deskStackExpanded: true,
		deskStackHomeX: stack.x,
		deskStackHomeY: stack.y,
		deskStackHomeZIndex: stack.zIndex,
	};
}

export function clearExpandedStackMeta() {
	return {
		deskStackExpanded: null,
		deskStackHomeX: null,
		deskStackHomeY: null,
		deskStackHomeZIndex: null,
	};
}

export function createStackPushMeta( stackId: string, shape: Pick< TLShape, 'x' | 'y' > ) {
	return {
		deskStackPushedBy: stackId,
		deskStackPushOriginX: shape.x,
		deskStackPushOriginY: shape.y,
	};
}

export function clearStackPushMeta() {
	return {
		deskStackPushedBy: null,
		deskStackPushOriginX: null,
		deskStackPushOriginY: null,
	};
}

export function clearStackMeta() {
	return {
		deskStackId: null,
		deskStackOrder: null,
		deskStackOriginalZIndex: null,
		...clearExpandedStackMeta(),
		...clearStackPushMeta(),
	};
}

export function createStackId() {
	return globalThis.crypto?.randomUUID?.() ?? `stack-${ Date.now().toString( 36 ) }`;
}

export function getWidgetIdFromShapeId( shapeId: string ) {
	return shapeId.startsWith( 'shape:' ) ? shapeId.slice( 'shape:'.length ) : shapeId;
}

function parseDeskZIndex( zIndex: string ) {
	const numericIndex = Number( zIndex.replace( /^a/, '' ) );
	return Number.isFinite( numericIndex ) ? numericIndex : null;
}

function formatDeskZIndex( numericIndex: number ) {
	return `a${ Number( numericIndex.toFixed( 3 ) ).toString() }`;
}
