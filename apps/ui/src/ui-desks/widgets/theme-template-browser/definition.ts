import { __ } from '@wordpress/i18n';
import { page } from '@wordpress/icons';
import { getIndicesAbove, type TLShape } from 'tldraw';
import { getThemeTemplates, type ThemeTemplate } from '@/ui-desks/widgets/theme/api';
import { THEME_TEMPLATE_WIDGET_TYPE, type ThemeTemplateWidget } from '../theme-template/types';
import {
	ThemeTemplateBrowserLoadingComponent,
	ThemeTemplateBrowserThumbnailComponent,
	ThemeTemplateBrowserWidgetComponent,
} from './component';
import { buildTemplateGraph } from './template-hierarchy';
import {
	isThemeTemplateBrowserWidgetProps,
	THEME_TEMPLATE_BROWSER_WIDGET_TYPE,
	type ThemeTemplateBrowserWidget,
} from './types';
import type {
	DeskMaterialization,
	DeskMaterializationContext,
	TemporaryDeskConnector,
} from '@/ui-desks/desk/provider/context';
import type { DeskConnector } from '@/ui-desks/desk/types';
import type { ResolvedDeskWidget, WidgetDefinition } from '@/ui-desks/widgets/types';

interface ThemeTemplateBrowserPosition {
	x: number;
	y: number;
}

interface ThemeTemplateBrowserMaterialization extends DeskMaterialization {
	widgets: ThemeTemplateWidget[];
}

const SOURCE_SHAPE_PROPS = {
	w: 1,
	h: 1,
};
const TEMPLATE_SHAPE_PROPS = {
	w: 280,
	h: 380,
};
const DEPTH_GAP = 200;
const SIBLING_GAP = 60;

export function getThemeTemplateBrowserTemporaryDeskId( sourceWidgetId: string ) {
	return `theme-template-browser:${ sourceWidgetId }`;
}

export const themeTemplateBrowserWidgetDefinition = {
	type: THEME_TEMPLATE_BROWSER_WIDGET_TYPE,
	name: () => __( 'Theme templates' ),
	Component: ThemeTemplateBrowserWidgetComponent,
	thumbnail: ThemeTemplateBrowserThumbnailComponent,
	loading: ThemeTemplateBrowserLoadingComponent,
	requiresRunningSite: true,
	isCreatable: false,
	shouldStartEditingOnCreate: false,
	isWidgetProps: isThemeTemplateBrowserWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 0,
		stroke: 'transparent',
	} ),
	labels: {
		add: () => __( 'Browse templates' ),
	},
	icon: page,
	getInitialWidget: () => ( {
		shapeProps: SOURCE_SHAPE_PROPS,
		widgetProps: {},
	} ),
	getSummary: () => __( 'Theme templates' ),
	getLoadingShapeProps: () => TEMPLATE_SHAPE_PROPS,
	resolver: {
		resolve: async ( widget, context ) =>
			createThemeTemplateBrowserResolution( widget, await getThemeTemplates( context ) ),
		invalidate: () => false,
	},
} satisfies WidgetDefinition< ThemeTemplateBrowserWidget >;

export function createThemeTemplateBrowserResolution(
	widget: ThemeTemplateBrowserWidget,
	templates: ThemeTemplate[]
) {
	const { positions } = createTemplateLayout( widget, templates );
	const widgets = positions.map( ( { template, ...position } ) =>
		createDerivedThemeTemplateWidget( widget, template, position )
	);

	return {
		identity: templates,
		widgets,
	};
}

export function createThemeTemplateBrowserMaterialization(
	context: DeskMaterializationContext,
	templates: ThemeTemplate[]
): ThemeTemplateBrowserMaterialization | null {
	if ( templates.length === 0 ) {
		return null;
	}

	const sourceId = createMaterializationId( 'theme-template-browser' );
	const { positions, edges } = createTemplateLayoutFromCenter( context.center, templates );
	const widgets = positions.map(
		( { template, ...position } ): ThemeTemplateWidget => ( {
			id: `${ sourceId }:template:${ sanitizeWidgetIdPart( template.slug || template.id ) }`,
			type: THEME_TEMPLATE_WIDGET_TYPE,
			x: position.x,
			y: position.y,
			zIndex: context.zIndex,
			shapeProps: TEMPLATE_SHAPE_PROPS,
			widgetProps: {
				templateId: template.id,
				slug: template.slug,
				title: template.title,
				description: template.description,
				source: template.source,
			},
		} )
	);
	const widgetIdsBySlug = new Map(
		widgets.map( ( templateWidget ) => [ templateWidget.widgetProps.slug, templateWidget.id ] )
	);
	const connectors = edges
		.map( ( edge ): DeskConnector | null => {
			const fromWidgetId = widgetIdsBySlug.get( edge.fromSlug );
			const toWidgetId = widgetIdsBySlug.get( edge.toSlug );
			if ( ! fromWidgetId || ! toWidgetId ) {
				return null;
			}

			return {
				id: `${ sourceId }:connector:${ sanitizeConnectorId(
					edge.fromSlug
				) }:${ sanitizeConnectorId( edge.toSlug ) }`,
				from: {
					widgetId: fromWidgetId,
					normalizedAnchor: { x: 0.5, y: 1 },
				},
				to: {
					widgetId: toWidgetId,
					normalizedAnchor: { x: 0.5, y: 0 },
				},
				bend: 24,
				appearance: {
					dash: 'solid',
					arrowheadStart: 'none',
					arrowheadEnd: 'none',
				},
			};
		} )
		.filter( ( connector ): connector is DeskConnector => connector !== null );

	return {
		widgets,
		selectWidgetIds: widgets.map( ( widget ) => widget.id ),
		...( connectors.length ? { connectors } : {} ),
	};
}

export function createThemeTemplateBrowserTemporaryDesk(
	widget: ThemeTemplateBrowserWidget,
	templates: ThemeTemplate[]
) {
	const { positions, edges } = createTemplateLayout( widget, templates );
	if ( positions.length === 0 ) {
		return null;
	}

	const zIndices = getIndicesAbove( widget.zIndex as TLShape[ 'index' ], positions.length );
	const widgets = positions.map( ( { template, ...position }, index ) => ( {
		...createThemeTemplateWidget( widget, template, position ),
		zIndex: zIndices[ index ],
	} ) );
	const widgetIdsBySlug = new Map(
		widgets.map( ( templateWidget ) => [ templateWidget.widgetProps.slug, templateWidget.id ] )
	);
	const connectors = edges
		.map( ( edge ): TemporaryDeskConnector | null => {
			const fromWidgetId = widgetIdsBySlug.get( edge.fromSlug );
			const toWidgetId = widgetIdsBySlug.get( edge.toSlug );
			if ( ! fromWidgetId || ! toWidgetId ) {
				return null;
			}

			return {
				id: `${ getThemeTemplateBrowserTemporaryDeskId(
					widget.id
				) }:connector:${ sanitizeConnectorId( edge.fromSlug ) }:${ sanitizeConnectorId(
					edge.toSlug
				) }`,
				from: {
					widgetId: fromWidgetId,
					normalizedAnchor: { x: 0.5, y: 1 },
				},
				to: {
					widgetId: toWidgetId,
					normalizedAnchor: { x: 0.5, y: 0 },
				},
				bend: 24,
				appearance: {
					dash: 'solid',
					arrowheadStart: 'none',
					arrowheadEnd: 'none',
				},
			};
		} )
		.filter( ( connector ): connector is TemporaryDeskConnector => connector !== null );

	return {
		id: getThemeTemplateBrowserTemporaryDeskId( widget.id ),
		widgets,
		...( connectors.length ? { connectors } : {} ),
	};
}

function createDerivedThemeTemplateWidget(
	source: ThemeTemplateBrowserWidget,
	template: ThemeTemplate,
	position: ThemeTemplateBrowserPosition
): ResolvedDeskWidget< ThemeTemplateWidget > {
	return {
		origin: {
			kind: 'derived',
			sourceWidgetId: source.id,
			key: `template:${ template.id }`,
		},
		widget: createThemeTemplateWidget( source, template, position ),
	};
}

function createThemeTemplateWidget(
	source: ThemeTemplateBrowserWidget,
	template: ThemeTemplate,
	position: ThemeTemplateBrowserPosition
): ThemeTemplateWidget {
	return {
		id: `${ source.id }:template:${ template.slug || template.id }`,
		type: THEME_TEMPLATE_WIDGET_TYPE,
		x: position.x,
		y: position.y,
		zIndex: source.zIndex,
		shapeProps: TEMPLATE_SHAPE_PROPS,
		widgetProps: {
			templateId: template.id,
			slug: template.slug,
			title: template.title,
			description: template.description,
			source: template.source,
		},
	};
}

function createTemplateLayout( widget: ThemeTemplateBrowserWidget, templates: ThemeTemplate[] ) {
	const { placements, edges, maxRowsPerCol } = buildTemplateGraph( templates );
	const maxRows = Math.max( 1, ...maxRowsPerCol.values() );
	const graphWidth = maxRows * TEMPLATE_SHAPE_PROPS.w + ( maxRows - 1 ) * SIBLING_GAP;
	const rawPositions = placements.map( ( placement ) => {
		const rowCount = maxRowsPerCol.get( placement.col ) ?? 1;
		const rowWidth = rowCount * TEMPLATE_SHAPE_PROPS.w + ( rowCount - 1 ) * SIBLING_GAP;
		const rowX = ( graphWidth - rowWidth ) / 2;

		return {
			template: placement.template,
			x: rowX + placement.row * ( TEMPLATE_SHAPE_PROPS.w + SIBLING_GAP ),
			y: placement.col * ( TEMPLATE_SHAPE_PROPS.h + DEPTH_GAP ),
		};
	} );
	const anchor = rawPositions[ 0 ] ?? { x: 0, y: 0 };

	return {
		edges,
		positions: rawPositions.map( ( position ) => ( {
			template: position.template,
			x: widget.x + position.x - anchor.x,
			y: widget.y + position.y - anchor.y,
		} ) ),
	};
}

function createTemplateLayoutFromCenter(
	center: { x: number; y: number },
	templates: ThemeTemplate[]
) {
	const { placements, edges, maxCol, maxRowsPerCol } = buildTemplateGraph( templates );
	const totalHeight = ( maxCol + 1 ) * TEMPLATE_SHAPE_PROPS.h + maxCol * DEPTH_GAP;
	const startY = center.y - totalHeight / 2;
	const rowXStart = new Map< number, number >();
	for ( const [ depth, siblings ] of maxRowsPerCol.entries() ) {
		const rowWidth = siblings * TEMPLATE_SHAPE_PROPS.w + ( siblings - 1 ) * SIBLING_GAP;
		rowXStart.set( depth, center.x - rowWidth / 2 );
	}

	return {
		edges,
		positions: placements.map( ( placement ) => ( {
			template: placement.template,
			x:
				( rowXStart.get( placement.col ) ?? center.x ) +
				placement.row * ( TEMPLATE_SHAPE_PROPS.w + SIBLING_GAP ),
			y: startY + placement.col * ( TEMPLATE_SHAPE_PROPS.h + DEPTH_GAP ),
		} ) ),
	};
}

function sanitizeConnectorId( value: string ) {
	return value.replace( /[^a-z0-9_-]/gi, '-' ) || 'template';
}

function createMaterializationId( prefix: string ) {
	return `${ prefix }:${ globalThis.crypto?.randomUUID?.() ?? Date.now().toString( 36 ) }`;
}

function sanitizeWidgetIdPart( value: string ) {
	return value.replace( /[^a-z0-9_-]/gi, '-' ) || 'template';
}
