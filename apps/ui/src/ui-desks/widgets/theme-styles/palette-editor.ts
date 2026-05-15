import { getIndicesAbove, type TLShape } from 'tldraw';
import { COLOR_WIDGET_TYPE, isHexColor, type ColorWidget } from '@/ui-desks/widgets/color/types';
import type { ThemeStylesWidget, ThemeStylesWidgetProps } from './types';
import type { TemporaryDeskConnector } from '@/ui-desks/desk/provider/context';
import type { DeskStack } from '@/ui-desks/desk/types';

const COLOR_WIDTH = 140;
const COLOR_HEIGHT = 140;
const PALETTE_GAP = 120;
const PALETTE_CONNECTOR_BEND = 72;
const OMITTED_PALETTE_SLUGS = new Set( [ 'background', 'base' ] );
const CENTER_CONNECTOR_ANCHOR = {
	x: 0.5,
	y: 0.5,
};

export function getThemeStylesPaletteTemporaryDeskId( sourceWidgetId: string ) {
	return `theme-styles-palette:${ sourceWidgetId }`;
}

export function createThemeStylesPaletteTemporaryDesk( sourceWidget: ThemeStylesWidget ) {
	const palette = getColorPaletteEntries( sourceWidget.widgetProps.palette );
	if ( palette.length === 0 ) {
		return null;
	}

	const id = getThemeStylesPaletteTemporaryDeskId( sourceWidget.id );
	const stackId = `${ id }:stack`;
	const widgetIds = palette.map(
		( entry, index ) => `${ id }:color:${ sanitizePaletteSlug( entry.slug ) }:${ index }`
	);
	const zIndices = getIndicesAbove( sourceWidget.zIndex as TLShape[ 'index' ], palette.length );
	const stackPosition = {
		x: sourceWidget.x + sourceWidget.shapeProps.w + PALETTE_GAP,
		y: sourceWidget.y + ( sourceWidget.shapeProps.h - COLOR_HEIGHT ) / 2,
	};
	const widgets = palette.map(
		( entry, index ): ColorWidget => ( {
			id: widgetIds[ index ],
			type: COLOR_WIDGET_TYPE,
			x: stackPosition.x,
			y: stackPosition.y,
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
		x: stackPosition.x,
		y: stackPosition.y,
		zIndex: zIndices[ zIndices.length - 1 ],
		memberIds: widgetIds,
		viewMode: 'circle',
	};
	const connectors: TemporaryDeskConnector[] = [
		{
			id: `${ id }:connector`,
			from: {
				widgetId: sourceWidget.id,
				normalizedAnchor: CENTER_CONNECTOR_ANCHOR,
			},
			to: {
				widgetId: widgetIds[ 0 ],
				normalizedAnchor: CENTER_CONNECTOR_ANCHOR,
			},
			bend: PALETTE_CONNECTOR_BEND,
			appearance: {
				dash: 'solid',
				arrowheadStart: 'none',
				arrowheadEnd: 'none',
			},
		},
	];

	return {
		id,
		widgets,
		stacks: [ stack ],
		connectors,
	};
}

export function getColorPaletteEntries( palette: ThemeStylesWidgetProps[ 'palette' ] ) {
	const filtered = palette.filter(
		( entry ) => isHexColor( entry.color ) && ! OMITTED_PALETTE_SLUGS.has( entry.slug )
	);

	return filtered.length > 0 ? filtered : palette.filter( ( entry ) => isHexColor( entry.color ) );
}

function sanitizePaletteSlug( slug: string ) {
	return slug.replace( /[^a-z0-9_-]/gi, '-' ) || 'color';
}
