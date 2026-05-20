import { getIndicesAbove, type TLShape, type TLShapePartial } from 'tldraw';
import type { DeskStack, DeskStackViewMode } from '@/ui-desks/desk/types';

export const STACK_TRANSLATE_X = 10;
export const STACK_TRANSLATE_Y = 8;
export const STACK_ROTATION = 0.052;
export const STACK_TILE_GAP = 16;
const STACK_Z_INDEX_STEP = 0.001;

export type StackViewMode = DeskStackViewMode;

export interface StackTileSize {
	w: number;
	h: number;
}

export interface DeskStackShapeMeta {
	deskStackId?: unknown;
	deskStackOrder?: unknown;
	deskStackViewMode?: unknown;
	deskStackOpenViewMode?: unknown;
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

export function getStackViewMode( shape: TLShape | null | undefined ): StackViewMode {
	const meta = shape?.meta as DeskStackShapeMeta | undefined;
	return meta?.deskStackViewMode === 'tiles' || meta?.deskStackViewMode === 'circle'
		? meta.deskStackViewMode
		: 'stack';
}

export function getStackConfiguredViewMode( shape: TLShape | null | undefined ): StackViewMode {
	const viewMode = getStackViewMode( shape );
	if ( viewMode !== 'stack' ) {
		return viewMode;
	}

	return getStackOpenViewMode( shape );
}

export function getStackOpenViewMode( shape: TLShape | null | undefined ): StackViewMode {
	const meta = shape?.meta as DeskStackShapeMeta | undefined;
	return meta?.deskStackOpenViewMode === 'circle' ? 'circle' : 'stack';
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

export function getStackFanStep( order: number, totalCount: number ) {
	const center = ( Math.max( 1, totalCount ) - 1 ) / 2;
	return order - center;
}

export function getStackMemberLayout(
	stack: Pick< DeskStack, 'x' | 'y' | 'memberIds' >,
	order: number
) {
	const step = getStackFanStep( order, stack.memberIds.length );

	return {
		x: stack.x + step * STACK_TRANSLATE_X,
		y: stack.y + step * STACK_TRANSLATE_Y,
		rotation: step * STACK_ROTATION,
	};
}

export function getStackAnchorFromMember(
	shape: Pick< TLShape, 'x' | 'y' >,
	order: number,
	totalCount: number
) {
	const step = getStackFanStep( order, totalCount );

	return {
		x: shape.x - step * STACK_TRANSLATE_X,
		y: shape.y - step * STACK_TRANSLATE_Y,
	};
}

export function getStackTileLayoutsFromCenter(
	sizes: StackTileSize[],
	center: { x: number; y: number }
) {
	const dimensions = getStackTileDimensions( sizes.length );
	const cellWidth = Math.max( ...sizes.map( ( size ) => size.w ), 1 );
	const cellHeight = Math.max( ...sizes.map( ( size ) => size.h ), 1 );
	const totalWidth = dimensions.columns * cellWidth + ( dimensions.columns - 1 ) * STACK_TILE_GAP;
	const totalHeight = dimensions.rows * cellHeight + ( dimensions.rows - 1 ) * STACK_TILE_GAP;
	const startX = center.x - totalWidth / 2;
	const startY = center.y - totalHeight / 2;

	return sizes.map( ( size, index ) => {
		const column = index % dimensions.columns;
		const row = Math.floor( index / dimensions.columns );
		const cellX = startX + column * ( cellWidth + STACK_TILE_GAP );
		const cellY = startY + row * ( cellHeight + STACK_TILE_GAP );

		return {
			x: cellX + ( cellWidth - size.w ) / 2,
			y: cellY + ( cellHeight - size.h ) / 2,
			rotation: 0,
		};
	} );
}

function getStackTileCenterFromFirstTile(
	sizes: StackTileSize[],
	firstTile: { x: number; y: number }
) {
	const dimensions = getStackTileDimensions( sizes.length );
	const firstSize = sizes[ 0 ] ?? { w: 1, h: 1 };
	const cellWidth = Math.max( ...sizes.map( ( size ) => size.w ), firstSize.w, 1 );
	const cellHeight = Math.max( ...sizes.map( ( size ) => size.h ), firstSize.h, 1 );
	const totalWidth = dimensions.columns * cellWidth + ( dimensions.columns - 1 ) * STACK_TILE_GAP;
	const totalHeight = dimensions.rows * cellHeight + ( dimensions.rows - 1 ) * STACK_TILE_GAP;

	return {
		x: firstTile.x - ( cellWidth - firstSize.w ) / 2 + totalWidth / 2,
		y: firstTile.y - ( cellHeight - firstSize.h ) / 2 + totalHeight / 2,
	};
}

export function getStackTileLayoutsFromFirstTile(
	sizes: StackTileSize[],
	firstTile: { x: number; y: number }
) {
	return getStackTileLayoutsFromCenter(
		sizes,
		getStackTileCenterFromFirstTile( sizes, firstTile )
	);
}

export function getStackCircleLayoutsFromCenter(
	sizes: StackTileSize[],
	center: { x: number; y: number }
) {
	const radius = getStackCircleRadius( sizes );

	return sizes.map( ( size, index ) => {
		const angle = ( 2 * Math.PI * index ) / sizes.length - Math.PI / 2;
		const centerX = center.x + Math.cos( angle ) * radius;
		const centerY = center.y + Math.sin( angle ) * radius;
		const rotation = angle + Math.PI / 2;
		const cos = Math.cos( rotation );
		const sin = Math.sin( rotation );
		const halfWidth = size.w / 2;
		const halfHeight = size.h / 2;

		return {
			x: centerX - halfWidth * cos + halfHeight * sin,
			y: centerY - halfWidth * sin - halfHeight * cos,
			rotation,
		};
	} );
}

function getStackCircleRadius( sizes: StackTileSize[] ) {
	const maxSize = Math.max( ...sizes.map( ( size ) => Math.max( size.w, size.h ) ), 1 );
	const desiredGap = 30;
	return Math.max( maxSize * 1.1, ( sizes.length * ( maxSize + desiredGap ) ) / ( 2 * Math.PI ) );
}

function getStackTileDimensions( count: number ) {
	if ( count <= 3 ) {
		return {
			rows: 1,
			columns: Math.max( 1, count ),
		};
	}
	if ( count <= 4 ) {
		return {
			rows: 2,
			columns: 2,
		};
	}
	if ( count <= 6 ) {
		return {
			rows: 2,
			columns: 3,
		};
	}
	if ( count <= 9 ) {
		return {
			rows: 3,
			columns: 3,
		};
	}

	return {
		rows: Math.ceil( count / 4 ),
		columns: 4,
	};
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

export function createStackMeta(
	stackId: string,
	order: number,
	originalZIndex?: string,
	viewMode: StackViewMode = 'stack'
) {
	return {
		deskStackId: stackId,
		deskStackOrder: order,
		deskStackViewMode: viewMode === 'tiles' ? 'tiles' : null,
		deskStackOpenViewMode: viewMode === 'circle' ? 'circle' : null,
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
		deskStackViewMode: null,
		deskStackOpenViewMode: null,
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
