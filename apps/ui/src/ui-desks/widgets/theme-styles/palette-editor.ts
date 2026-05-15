import {
	createShapeId,
	getIndicesAbove,
	sortByIndex,
	type Editor,
	type TLArrowShape,
	type TLShapePartial,
	type TLShape,
} from 'tldraw';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
} from '@/ui-desks/shapes/rectangle-widget/types';
import {
	createStackId,
	createStackMeta,
	getStackId,
	getStackMemberLayout,
} from '@/ui-desks/stacks/utils';
import { COLOR_WIDGET_TYPE, isHexColor, type ColorWidget } from '@/ui-desks/widgets/color/types';
import {
	isThemeStylesWidgetProps,
	THEME_STYLES_WIDGET_TYPE,
	type ThemeStylesWidget,
	type ThemeStylesWidgetProps,
} from './types';
import type { DeskStack } from '@/ui-desks/desk/types';

export const THEME_STYLES_TOGGLE_PALETTE_ACTION = 'toggle-palette';

const COLOR_WIDTH = 140;
const COLOR_HEIGHT = 140;
const PALETTE_GAP = 120;
const COLOR_STEP_GAP = 8;
const PALETTE_CONNECTOR_BEND = 72;
const OMITTED_PALETTE_SLUGS = new Set( [ 'background', 'base' ] );
const CENTER_CONNECTOR_ANCHOR = {
	x: 0.5,
	y: 0.5,
};
const DERIVED_PALETTE_META = {
	studioDeskOrigin: 'derived',
	studioDeskPersist: false,
} as const;

export function toggleThemeStylesPaletteInEditor(
	editor: Editor,
	shape: TLShape,
	widget: ThemeStylesWidget
) {
	const existingStackId = getThemeStylesPaletteStackId( shape );
	if ( existingStackId ) {
		removePaletteStackInEditor( editor, shape, widget, existingStackId );
		return true;
	}

	const palette = getColorPaletteEntries( widget.widgetProps.palette );
	if ( palette.length === 0 ) {
		return false;
	}

	const stackId = createPaletteStackInEditor( editor, shape, widget, palette );
	setThemeStylesPaletteStackId( editor, shape, widget, stackId );
	return true;
}

export function moveThemeStylesPaletteWithShapeInEditor(
	editor: Editor,
	previousShape: TLShape,
	nextShape: TLShape,
	widget: ThemeStylesWidget
) {
	if ( previousShape.x === nextShape.x && previousShape.y === nextShape.y ) {
		return false;
	}

	const stackId = getThemeStylesPaletteStackId( nextShape, widget );
	if ( ! stackId ) {
		return false;
	}

	const deltaX = nextShape.x - previousShape.x;
	const deltaY = nextShape.y - previousShape.y;
	const members = editor
		.getCurrentPageShapes()
		.filter( ( shape ) => getStackId( shape ) === stackId );
	if ( members.length === 0 ) {
		return false;
	}

	editor.updateShapes(
		members.map( ( member ) => ( {
			id: member.id,
			type: member.type,
			x: member.x + deltaX,
			y: member.y + deltaY,
		} ) )
	);
	return true;
}

export function getThemeStylesPaletteStackId(
	shape: TLShape | null | undefined,
	widget?: ThemeStylesWidget
) {
	const meta = shape?.meta as { paletteStackId?: unknown } | undefined;
	if ( typeof meta?.paletteStackId === 'string' ) {
		return meta.paletteStackId;
	}

	return widget &&
		widget.type === THEME_STYLES_WIDGET_TYPE &&
		isThemeStylesWidgetProps( widget.widgetProps ) &&
		typeof widget.widgetProps.paletteStackId === 'string'
		? widget.widgetProps.paletteStackId
		: null;
}

export function getColorPaletteEntries( palette: ThemeStylesWidgetProps[ 'palette' ] ) {
	const filtered = palette.filter(
		( entry ) => isHexColor( entry.color ) && ! OMITTED_PALETTE_SLUGS.has( entry.slug )
	);

	return filtered.length > 0 ? filtered : palette.filter( ( entry ) => isHexColor( entry.color ) );
}

function createPaletteStackInEditor(
	editor: Editor,
	sourceShape: TLShape,
	sourceWidget: ThemeStylesWidget,
	palette: Array< { slug: string; name?: string; color: string } >
) {
	const stackId = createStackId();
	const colorWidgetIds = palette.map( () => createPaletteWidgetId() );
	const zIndices = getIndicesAbove(
		getHighestShapeIndex( editor.getCurrentPageShapes() ),
		palette.length
	);
	const startX = sourceShape.x + sourceWidget.shapeProps.w + PALETTE_GAP;
	const startY = sourceShape.y + ( sourceWidget.shapeProps.h - COLOR_HEIGHT ) / 2;
	const colorWidgets = palette.map(
		( entry, index ): ColorWidget => ( {
			id: colorWidgetIds[ index ],
			type: COLOR_WIDGET_TYPE,
			x: startX + index * ( COLOR_WIDTH + COLOR_STEP_GAP ),
			y: startY,
			zIndex: zIndices[ index ],
			shapeProps: {
				w: COLOR_WIDTH,
				h: COLOR_HEIGHT,
			},
			widgetProps: {
				color: entry.color,
				title: entry.name ?? entry.slug,
			},
		} )
	);
	const stack: DeskStack = {
		id: stackId,
		x: startX,
		y: startY,
		zIndex: zIndices[ zIndices.length - 1 ],
		memberIds: colorWidgetIds,
	};

	editor.createShapes(
		colorWidgets.map( ( widget, order ) =>
			colorWidgetToStackShape( widget, stack, order, zIndices[ zIndices.length - order - 1 ] )
		)
	);
	createPaletteConnectorInEditor( editor, sourceShape, colorWidgetIds[ 0 ], stackId );
	return stackId;
}

function createPaletteConnectorInEditor(
	editor: Editor,
	sourceShape: TLShape,
	topColorWidgetId: string,
	stackId: string
) {
	const arrowId = createShapeId( getPaletteConnectorId( stackId ) ) as TLArrowShape[ 'id' ];
	editor.createShape< TLArrowShape >( {
		id: arrowId,
		type: 'arrow',
		props: {
			kind: 'arc',
			color: 'black',
			dash: 'solid',
			size: 'm',
			bend: PALETTE_CONNECTOR_BEND,
			arrowheadStart: 'none',
			arrowheadEnd: 'none',
			start: { x: 0, y: 0 },
			end: { x: 0, y: 0 },
		},
		meta: {
			...DERIVED_PALETTE_META,
			stylesPaletteLink: true,
			linkedStackId: stackId,
		},
	} );
	editor.createBindings( [
		{
			type: 'arrow' as const,
			fromId: arrowId,
			toId: sourceShape.id,
			props: {
				terminal: 'start' as const,
				normalizedAnchor: CENTER_CONNECTOR_ANCHOR,
				isExact: false,
				isPrecise: false,
				snap: 'none' as const,
			},
		},
		{
			type: 'arrow' as const,
			fromId: arrowId,
			toId: createShapeId( topColorWidgetId ),
			props: {
				terminal: 'end' as const,
				normalizedAnchor: CENTER_CONNECTOR_ANCHOR,
				isExact: false,
				isPrecise: false,
				snap: 'none' as const,
			},
		},
	] );
	editor.sendToBack( [ arrowId ] );
}

function colorWidgetToStackShape(
	widget: ColorWidget,
	stack: DeskStack,
	order: number,
	index: TLShapePartial[ 'index' ]
): TLShapePartial {
	return {
		id: createShapeId( widget.id ),
		type: RECTANGLE_WIDGET_SHAPE_TYPE,
		...getStackMemberLayout( stack, order ),
		index,
		meta: {
			...createStackMeta( stack.id, order, widget.zIndex ),
			...DERIVED_PALETTE_META,
		},
		props: {
			widgetType: widget.type,
			shapeProps: widget.shapeProps,
			widgetProps: widget.widgetProps,
		},
	};
}

function removePaletteStackInEditor(
	editor: Editor,
	sourceShape: TLShape,
	sourceWidget: ThemeStylesWidget,
	stackId: string
) {
	const memberIds = new Set(
		editor
			.getCurrentPageShapes()
			.filter( ( shape ) => getStackId( shape ) === stackId )
			.map( ( shape ) => shape.id )
	);
	const arrowIds = editor
		.getCurrentPageShapes()
		.filter( ( shape ) => {
			const meta = shape.meta as
				| { stylesPaletteLink?: unknown; linkedStackId?: unknown }
				| undefined;
			return meta?.stylesPaletteLink === true && meta.linkedStackId === stackId;
		} )
		.map( ( shape ) => shape.id );
	const shapeIds = [ ...memberIds, ...arrowIds ];
	if ( shapeIds.length > 0 ) {
		editor.deleteShapes( shapeIds );
	}
	setThemeStylesPaletteStackId( editor, sourceShape, sourceWidget, null );
}

function setThemeStylesPaletteStackId(
	editor: Editor,
	sourceShape: TLShape,
	sourceWidget: ThemeStylesWidget,
	stackId: string | null
) {
	const shape = sourceShape as RectangleWidgetShape;
	editor.updateShape< RectangleWidgetShape >( {
		id: shape.id,
		type: RECTANGLE_WIDGET_SHAPE_TYPE,
		props: {
			widgetProps: {
				...sourceWidget.widgetProps,
				paletteStackId: stackId,
			} as unknown as RectangleWidgetShape[ 'props' ][ 'widgetProps' ],
		},
		meta: {
			...( sourceShape.meta ?? {} ),
			paletteStackId: stackId,
		},
	} );
}

function getHighestShapeIndex( shapes: TLShape[] ): TLShape[ 'index' ] | null {
	return (
		shapes
			.filter( ( shape ): shape is TLShape & { index: NonNullable< TLShape[ 'index' ] > } =>
				Boolean( shape.index )
			)
			.sort( sortByIndex )
			.at( -1 )?.index ?? null
	);
}

function getPaletteConnectorId( stackId: string ) {
	return `${ stackId }-connector`;
}

function createPaletteWidgetId() {
	return globalThis.crypto?.randomUUID?.() ?? `palette-color-${ Date.now().toString( 36 ) }`;
}
