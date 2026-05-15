import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { getIndicesAbove, sortByIndex, type TLShape } from 'tldraw';
import { useDesk } from '@/ui-desks/desk/provider';
import { createWidgetId } from '@/ui-desks/desk/provider/editor-state';
import { createStackId } from '@/ui-desks/stacks/utils';
import { COLOR_WIDGET_TYPE, isHexColor } from '@/ui-desks/widgets/color/types';
import styles from './palette-control.module.css';
import {
	isThemeStylesWidgetProps,
	THEME_STYLES_WIDGET_TYPE,
	type ThemeStylesWidget,
	type ThemeStylesWidgetProps,
} from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';
import type { DeskConfig } from '@/ui-desks/desk/types';
import type { ColorWidget } from '@/ui-desks/widgets/color/types';
import type { DeskWidget } from '@/ui-desks/widgets/types';

const COLOR_WIDTH = 140;
const COLOR_HEIGHT = 140;
const PALETTE_GAP = 120;
const COLOR_STEP_GAP = 8;
const PALETTE_CONNECTOR_ANCHOR = {
	x: 0,
	y: 0.5,
};
const STYLES_CONNECTOR_ANCHOR = {
	x: 1,
	y: 0.5,
};
const OMITTED_PALETTE_SLUGS = new Set( [ 'background', 'base' ] );

export function ThemeStylesPaletteControl( {
	props,
}: ControlRenderContext< ThemeStylesWidgetProps > ) {
	const [ isPending, setIsPending ] = useState( false );
	const { getDeskConfigSnapshot, replaceDeskConfig, selectedWidgetToolbarItem } = useDesk();
	const palette = getColorPaletteEntries( props.palette );

	if ( palette.length === 0 ) {
		return null;
	}

	async function togglePalette() {
		if ( selectedWidgetToolbarItem?.kind !== 'single-widget' ) {
			return;
		}

		const desk = getDeskConfigSnapshot();
		if ( ! desk ) {
			return;
		}

		const sourceWidget = desk.widgets.find(
			( widget ): widget is ThemeStylesWidget =>
				widget.id === selectedWidgetToolbarItem.widget.id &&
				widget.type === THEME_STYLES_WIDGET_TYPE &&
				isThemeStylesWidgetProps( widget.widgetProps )
		);
		if ( ! sourceWidget ) {
			return;
		}

		const existingStackId =
			typeof sourceWidget.widgetProps.paletteStackId === 'string'
				? sourceWidget.widgetProps.paletteStackId
				: null;
		const existingStack = existingStackId
			? desk.stacks?.find( ( stack ) => stack.id === existingStackId )
			: null;

		setIsPending( true );
		try {
			const nextDesk = existingStack
				? removePaletteStack( desk, sourceWidget, existingStack.id )
				: addPaletteStack( desk, sourceWidget, palette );
			await replaceDeskConfig( nextDesk );
		} finally {
			setIsPending( false );
		}
	}

	return (
		<button
			type="button"
			className={ styles.button }
			data-active={ props.paletteStackId ? 'true' : 'false' }
			disabled={ isPending }
			onClick={ () => {
				void togglePalette();
			} }
		>
			{ __( 'Colors' ) }
		</button>
	);
}

function addPaletteStack(
	desk: DeskConfig,
	sourceWidget: ThemeStylesWidget,
	palette: Array< { slug: string; name?: string; color: string } >
): DeskConfig {
	const stackId = createStackId();
	const colorWidgetIds = palette.map( () => createWidgetId() );
	const zIndices = getIndicesAbove( getHighestWidgetZIndex( desk.widgets ), palette.length );
	const startX = sourceWidget.x + sourceWidget.shapeProps.w + PALETTE_GAP;
	const startY = sourceWidget.y + ( sourceWidget.shapeProps.h - COLOR_HEIGHT ) / 2;
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

	return {
		...desk,
		widgets: [
			...desk.widgets.map( ( widget ) =>
				widget.id === sourceWidget.id
					? {
							...sourceWidget,
							widgetProps: {
								...sourceWidget.widgetProps,
								paletteStackId: stackId,
							},
					  }
					: widget
			),
			...colorWidgets,
		] as DeskWidget[],
		stacks: [
			...( desk.stacks ?? [] ),
			{
				id: stackId,
				x: startX,
				y: startY,
				zIndex: zIndices[ zIndices.length - 1 ],
				memberIds: colorWidgetIds,
			},
		],
		connectors: [
			...( desk.connectors ?? [] ),
			{
				id: getPaletteConnectorId( stackId ),
				from: {
					widgetId: sourceWidget.id,
					normalizedAnchor: STYLES_CONNECTOR_ANCHOR,
				},
				to: {
					widgetId: colorWidgetIds[ 0 ],
					normalizedAnchor: PALETTE_CONNECTOR_ANCHOR,
				},
			},
		],
	};
}

function removePaletteStack(
	desk: DeskConfig,
	sourceWidget: ThemeStylesWidget,
	stackId: string
): DeskConfig {
	const stack = desk.stacks?.find( ( candidate ) => candidate.id === stackId );
	const memberIds = new Set( stack?.memberIds ?? [] );
	const connectorId = getPaletteConnectorId( stackId );
	const widgets = desk.widgets
		.filter( ( widget ) => ! memberIds.has( widget.id ) )
		.map( ( widget ) =>
			widget.id === sourceWidget.id
				? {
						...sourceWidget,
						widgetProps: omitPaletteStackId( sourceWidget.widgetProps ),
				  }
				: widget
		) as DeskWidget[];
	const stacks = ( desk.stacks ?? [] ).filter( ( candidate ) => candidate.id !== stackId );
	const connectors = ( desk.connectors ?? [] ).filter(
		( connector ) =>
			connector.id !== connectorId &&
			! memberIds.has( connector.from.widgetId ) &&
			! memberIds.has( connector.to.widgetId )
	);

	return {
		...desk,
		widgets,
		...( stacks.length > 0 ? { stacks } : { stacks: undefined } ),
		...( connectors.length > 0 ? { connectors } : { connectors: undefined } ),
	};
}

function getColorPaletteEntries( palette: ThemeStylesWidgetProps[ 'palette' ] ) {
	const filtered = palette.filter(
		( entry ) => isHexColor( entry.color ) && ! OMITTED_PALETTE_SLUGS.has( entry.slug )
	);

	return filtered.length > 0 ? filtered : palette.filter( ( entry ) => isHexColor( entry.color ) );
}

function getHighestWidgetZIndex( widgets: DeskWidget[] ): TLShape[ 'index' ] | null {
	return (
		widgets
			.map( ( widget ) => ( { index: widget.zIndex as TLShape[ 'index' ] } ) )
			.sort( sortByIndex )
			.at( -1 )?.index ?? null
	);
}

function getPaletteConnectorId( stackId: string ) {
	return `${ stackId }-connector`;
}

function omitPaletteStackId( props: ThemeStylesWidgetProps ): ThemeStylesWidgetProps {
	const { paletteStackId: _paletteStackId, ...nextProps } = props;
	return nextProps;
}
