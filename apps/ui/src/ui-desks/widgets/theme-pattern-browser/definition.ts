import { __ } from '@wordpress/i18n';
import { blockDefault, category } from '@wordpress/icons';
import { getIndicesAbove, type TLShape } from 'tldraw';
import { getStackTileLayoutsFromFirstTile } from '@/ui-desks/stacks/utils';
import { getThemePatterns, type ThemePattern } from '@/ui-desks/widgets/theme/api';
import { THEME_PATTERN_WIDGET_TYPE, type ThemePatternWidget } from '../theme-pattern/types';
import {
	ThemePatternBrowserLoadingComponent,
	ThemePatternBrowserThumbnailComponent,
	ThemePatternBrowserWidgetComponent,
} from './component';
import {
	isThemePatternBrowserWidgetProps,
	THEME_PATTERN_BROWSER_WIDGET_TYPE,
	type ThemePatternBrowserWidget,
	type ThemePatternBrowserWidgetProps,
} from './types';
import type {
	DeskMaterialization,
	DeskMaterializationContext,
} from '@/ui-desks/desk/provider/context';
import type {
	ResolvedDeskStack,
	ResolvedDeskWidget,
	WidgetDefinition,
} from '@/ui-desks/widgets/types';

interface ThemePatternBrowserPosition {
	x: number;
	y: number;
	rotation?: number;
}

interface ThemePatternBrowserMaterialization extends DeskMaterialization {
	widgets: ThemePatternWidget[];
}

const SOURCE_SHAPE_PROPS = {
	w: 1,
	h: 1,
};
const PATTERN_SHAPE_PROPS = {
	w: 320,
	h: 220,
};
const DEFAULT_PATTERN_LIMIT = 10;
const STACK_VIEW_MODE_OPTIONS: Array< {
	value: NonNullable< ThemePatternBrowserWidgetProps[ 'viewMode' ] >;
	label: string;
} > = [
	{ value: 'stack', label: __( 'Stack' ) },
	{ value: 'tiles', label: __( 'Tiles' ) },
	{ value: 'circle', label: __( 'Circle' ) },
];

export function getThemePatternBrowserTemporaryDeskId( sourceWidgetId: string ) {
	return `theme-pattern-browser:${ sourceWidgetId }`;
}

export const themePatternBrowserWidgetDefinition = {
	type: THEME_PATTERN_BROWSER_WIDGET_TYPE,
	name: () => __( 'Theme patterns' ),
	Component: ThemePatternBrowserWidgetComponent,
	thumbnail: ThemePatternBrowserThumbnailComponent,
	loading: ThemePatternBrowserLoadingComponent,
	controls: [
		{
			type: 'select',
			id: 'view-mode',
			property: 'viewMode',
			label: __( 'Display' ),
			icon: category,
			defaultValue: 'tiles',
			options: STACK_VIEW_MODE_OPTIONS,
		},
	],
	requiresRunningSite: true,
	isCreatable: false,
	shouldStartEditingOnCreate: false,
	isWidgetProps: isThemePatternBrowserWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 0,
		stroke: 'transparent',
	} ),
	labels: {
		add: () => __( 'Browse patterns' ),
	},
	icon: blockDefault,
	getInitialWidget: () => ( {
		shapeProps: SOURCE_SHAPE_PROPS,
		widgetProps: {
			limit: DEFAULT_PATTERN_LIMIT,
			viewMode: 'tiles',
		},
	} ),
	getSummary: () => __( 'Theme patterns' ),
	getLoadingShapeProps: () => PATTERN_SHAPE_PROPS,
	resolver: {
		resolve: async ( widget, context ) =>
			createThemePatternBrowserResolution( widget, await getThemePatterns( context ) ),
		invalidate: () => false,
	},
} satisfies WidgetDefinition< ThemePatternBrowserWidget >;

export function createThemePatternBrowserResolution(
	widget: ThemePatternBrowserWidget,
	patterns: ThemePattern[]
) {
	const browsablePatterns = pickBrowsablePatterns( patterns, widget.widgetProps.limit );
	const positions = getPatternPositions( widget, browsablePatterns.length );
	const widgets = browsablePatterns.map( ( pattern, index ) =>
		createDerivedThemePatternWidget( widget, pattern, positions[ index ] )
	);

	return {
		identity: {
			patterns: browsablePatterns,
			limit: widget.widgetProps.limit,
		},
		widgets,
		stacks:
			widgets.length > 1
				? [
						createDerivedThemePatternStack(
							widget,
							widgets.map( ( resolvedWidget ) => resolvedWidget.widget.id )
						),
				  ]
				: [],
	};
}

export function createThemePatternBrowserMaterialization(
	context: DeskMaterializationContext,
	patterns: ThemePattern[]
): ThemePatternBrowserMaterialization | null {
	const sourceId = createMaterializationId( 'theme-pattern-browser' );
	const browsablePatterns = pickBrowsablePatterns( patterns, DEFAULT_PATTERN_LIMIT );
	if ( browsablePatterns.length === 0 ) {
		return null;
	}

	const x = context.center.x - PATTERN_SHAPE_PROPS.w / 2;
	const y = context.center.y - PATTERN_SHAPE_PROPS.h / 2;
	const widgets = browsablePatterns.map(
		( pattern ): ThemePatternWidget => ( {
			id: `${ sourceId }:${ pattern.source }:${ sanitizeWidgetIdPart( pattern.id ) }`,
			type: THEME_PATTERN_WIDGET_TYPE,
			x,
			y,
			zIndex: context.zIndex,
			shapeProps: PATTERN_SHAPE_PROPS,
			widgetProps: {
				patternId: pattern.id,
				title: pattern.title,
				content: pattern.content,
				source: pattern.source,
				...( pattern.blockId !== undefined ? { blockId: pattern.blockId } : {} ),
				...( pattern.area ? { area: pattern.area } : {} ),
			},
		} )
	);

	return {
		widgets,
		selectWidgetIds: widgets.map( ( widget ) => widget.id ),
		stacks:
			widgets.length > 1
				? [
						{
							id: `${ sourceId }:patterns`,
							x,
							y,
							zIndex: context.zIndex,
							memberIds: widgets.map( ( widget ) => widget.id ),
						},
				  ]
				: undefined,
	};
}

export function createThemePatternBrowserTemporaryDesk(
	widget: ThemePatternBrowserWidget,
	patterns: ThemePattern[]
) {
	const resolution = createThemePatternBrowserResolution( widget, patterns );
	if ( resolution.widgets.length === 0 ) {
		return null;
	}

	const zIndices = getIndicesAbove(
		widget.zIndex as TLShape[ 'index' ],
		resolution.widgets.length
	);
	const widgets = resolution.widgets.map( ( resolvedWidget, index ) => ( {
		...resolvedWidget.widget,
		zIndex: zIndices[ index ],
	} ) );
	const stacks = resolution.stacks?.map( ( resolvedStack ) => ( {
		...resolvedStack.stack,
		zIndex: zIndices[ zIndices.length - 1 ] ?? resolvedStack.stack.zIndex,
	} ) );

	return {
		id: getThemePatternBrowserTemporaryDeskId( widget.id ),
		widgets,
		...( stacks?.length ? { stacks } : {} ),
	};
}

function pickBrowsablePatterns( patterns: ThemePattern[], limit: number ) {
	const essentialPatterns = patterns.filter(
		( pattern ) => pattern.source === 'template-part' || pattern.source === 'reusable'
	);
	const themePatterns = patterns.filter( ( pattern ) => pattern.source === 'theme' );
	return [ ...essentialPatterns, ...themePatterns ].slice( 0, limit );
}

function createDerivedThemePatternStack(
	source: ThemePatternBrowserWidget,
	memberIds: string[]
): ResolvedDeskStack {
	return {
		origin: {
			kind: 'derived',
			sourceWidgetId: source.id,
			key: 'patterns',
		},
		stack: {
			id: `theme-pattern-browser:${ source.id }:patterns`,
			x: source.x,
			y: source.y,
			zIndex: source.zIndex,
			memberIds,
			...( source.widgetProps.viewMode && source.widgetProps.viewMode !== 'stack'
				? { viewMode: source.widgetProps.viewMode }
				: {} ),
		},
	};
}

function createDerivedThemePatternWidget(
	source: ThemePatternBrowserWidget,
	pattern: ThemePattern,
	position: ThemePatternBrowserPosition
): ResolvedDeskWidget< ThemePatternWidget > {
	return {
		origin: {
			kind: 'derived',
			sourceWidgetId: source.id,
			key: `${ pattern.source }:${ pattern.id }`,
		},
		widget: {
			id: `${ source.id }:${ pattern.source }:${ pattern.id }`,
			type: THEME_PATTERN_WIDGET_TYPE,
			x: position.x,
			y: position.y,
			...( position.rotation !== undefined ? { rotation: position.rotation } : {} ),
			zIndex: source.zIndex,
			shapeProps: PATTERN_SHAPE_PROPS,
			widgetProps: {
				patternId: pattern.id,
				title: pattern.title,
				content: pattern.content,
				source: pattern.source,
				...( pattern.blockId !== undefined ? { blockId: pattern.blockId } : {} ),
				...( pattern.area ? { area: pattern.area } : {} ),
			},
		},
	};
}

function getPatternPositions( widget: ThemePatternBrowserWidget, count: number ) {
	if ( widget.widgetProps.viewMode !== 'tiles' ) {
		return Array.from( { length: count }, () => ( {
			x: widget.x,
			y: widget.y,
		} ) );
	}

	const sizes = Array.from( { length: count }, () => PATTERN_SHAPE_PROPS );
	return getStackTileLayoutsFromFirstTile( sizes, {
		x: widget.x,
		y: widget.y,
	} ).map( ( layout ) => ( {
		x: layout.x,
		y: layout.y,
	} ) );
}

function createMaterializationId( prefix: string ) {
	return `${ prefix }:${ globalThis.crypto?.randomUUID?.() ?? Date.now().toString( 36 ) }`;
}

function sanitizeWidgetIdPart( value: string ) {
	return value.replace( /[^a-z0-9_-]/gi, '-' ) || 'pattern';
}
