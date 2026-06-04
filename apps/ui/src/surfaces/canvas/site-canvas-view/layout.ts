import { getIndicesAbove, type TLShape } from 'tldraw';
import { DESK_CONFIG_VERSION, type DeskConfig } from '@/ui-desks/desk/types';
import { THEME_CARD_SHAPE_PROPS, THEME_WIDGET_TYPE } from '@/ui-desks/widgets/theme/types';
import type { ThemeWidget } from '@/ui-desks/widgets/theme/types';
import type { DeskWidget } from '@/ui-desks/widgets/types';

export const THEME_CANVAS_THEME_WIDGET_ID = 'theme-canvas-active-theme';

const DEFAULT_THEME_X = 120;
const DEFAULT_THEME_Y = 120;

export function createSiteMapCanvasDeskConfig(
	siteMapConfig: DeskConfig,
	savedConfig?: DeskConfig
): DeskConfig {
	return {
		version: DESK_CONFIG_VERSION,
		updatedAt: new Date().toISOString(),
		viewport: savedConfig?.viewport,
		widgets: mergeWidgetsWithSavedLayout( siteMapConfig.widgets, savedConfig ),
		connectors: siteMapConfig.connectors,
	};
}

export function createThemeCanvasDeskConfig( savedConfig?: DeskConfig ): DeskConfig {
	return {
		version: DESK_CONFIG_VERSION,
		updatedAt: new Date().toISOString(),
		viewport: savedConfig?.viewport,
		widgets: mergeWidgetsWithSavedLayout( [ createThemeWidget( savedConfig ) ], savedConfig ),
	};
}

export function getSiteCanvasDeskConfigSignature( siteMapSignature: string, config: DeskConfig ) {
	const widgetSignature = config.widgets
		.map(
			( widget ) =>
				`${ widget.id }:${ widget.type }:${ Math.round( widget.x ) }:${ Math.round( widget.y ) }`
		)
		.join( '|' );
	const viewport = config.viewport
		? `${ Math.round( config.viewport.x ) }:${ Math.round(
				config.viewport.y
		  ) }:${ config.viewport.z.toFixed( 3 ) }`
		: '';

	return `${ siteMapSignature }|${ viewport }|${ widgetSignature }`;
}

function mergeWidgetsWithSavedLayout(
	widgets: DeskWidget[],
	savedConfig: DeskConfig | undefined
): DeskWidget[] {
	const savedWidgets = new Map(
		( savedConfig?.widgets ?? [] ).map( ( widget ) => [ widget.id, widget ] )
	);

	return widgets.map( ( widget ) => {
		const saved = savedWidgets.get( widget.id );
		if ( ! saved || saved.type !== widget.type ) {
			return widget;
		}

		return {
			...widget,
			x: saved.x,
			y: saved.y,
			rotation: saved.rotation,
			zIndex: saved.zIndex,
			shapeProps: {
				...widget.shapeProps,
				...saved.shapeProps,
			},
		} as DeskWidget;
	} );
}

function createThemeWidget( savedConfig: DeskConfig | undefined ): ThemeWidget {
	const savedTheme = savedConfig?.widgets.find(
		( widget ) => widget.id === THEME_CANVAS_THEME_WIDGET_ID && widget.type === THEME_WIDGET_TYPE
	) as ThemeWidget | undefined;
	const highestIndex = savedConfig?.widgets.at( -1 )?.zIndex as TLShape[ 'index' ] | undefined;

	return {
		id: THEME_CANVAS_THEME_WIDGET_ID,
		type: THEME_WIDGET_TYPE,
		x: DEFAULT_THEME_X,
		y: DEFAULT_THEME_Y,
		zIndex: savedTheme?.zIndex ?? getIndicesAbove( highestIndex ?? null, 1 )[ 0 ],
		shapeProps: THEME_CARD_SHAPE_PROPS,
		widgetProps: {
			viewMode: 'tiles',
		},
	};
}
