import { __ } from '@wordpress/i18n';
import { globe, layout, styles as stylesIcon, typography } from '@wordpress/icons';
import { getStackTileLayoutsFromCenter } from '@/ui-desks/stacks/utils';
import {
	getThemeMaterials,
	type ThemeMaterials,
	type ThemePattern,
	type ThemeTemplate,
} from '@/ui-desks/widgets/theme/api';
import {
	ThemeWidgetComponent,
	ThemeWidgetLoadingComponent,
	ThemeWidgetThumbnailComponent,
} from '@/ui-desks/widgets/theme/component';
import { ThemeSiteUrlControl } from '@/ui-desks/widgets/theme/site-url-control';
import { THEME_PATTERN_WIDGET_TYPE, type ThemePatternWidget } from '../theme-pattern/types';
import { getThemeStylesWidgetProps } from '../theme-styles/defaults';
import { THEME_STYLES_WIDGET_TYPE, type ThemeStylesWidget } from '../theme-styles/types';
import { THEME_TEMPLATE_WIDGET_TYPE, type ThemeTemplateWidget } from '../theme-template/types';
import {
	getThemeMaterialsStackId,
	getThemeMaterialsStackPosition,
	isThemeWidgetProps,
	THEME_CARD_SHAPE_PROPS,
	THEME_MATERIAL_SHAPE_PROPS,
	THEME_WIDGET_TYPE,
	type ThemeWidget,
} from './types';
import type {
	ResolvedDeskStack,
	ResolvedDeskWidget,
	WidgetDefinition,
} from '@/ui-desks/widgets/types';

type ThemeMaterialResolvedWidget =
	| ResolvedDeskWidget< ThemeTemplateWidget >
	| ResolvedDeskWidget< ThemeStylesWidget >
	| ResolvedDeskWidget< ThemePatternWidget >;

interface ThemeMaterialPosition {
	x: number;
	y: number;
	rotation?: number;
}

export const themeWidgetDefinition = {
	type: THEME_WIDGET_TYPE,
	name: () => __( 'Theme' ),
	Component: ThemeWidgetComponent,
	thumbnail: ThemeWidgetThumbnailComponent,
	loading: ThemeWidgetLoadingComponent,
	controls: [
		{
			type: 'custom',
			id: 'theme-font-library',
			Component: ThemeSiteUrlControl( {
				icon: typography,
				path: '/wp-admin/admin.php?page=font-library-wp-admin',
				label: __( 'Font library' ),
			} ),
		},
		{
			type: 'custom',
			id: 'theme-styles',
			Component: ThemeSiteUrlControl( {
				icon: stylesIcon,
				path: '/wp-admin/site-editor.php?path=%2Fwp_global_styles',
				label: __( 'Styles' ),
				requiresBlockTheme: true,
			} ),
		},
		{
			type: 'custom',
			id: 'theme-browser',
			Component: ThemeSiteUrlControl( {
				icon: layout,
				path: '/wp-admin/themes.php',
				label: __( 'Browse themes' ),
			} ),
		},
	],
	requiresRunningSite: true,
	shouldStartEditingOnCreate: false,
	preserveSourceWidgetPosition: true,
	isWidgetProps: isThemeWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 20,
		stroke: 'color-mix(in srgb, #3858e9 35%, white)',
	} ),
	labels: {
		add: () => __( 'New theme card' ),
	},
	icon: globe,
	getInitialWidget: () => ( {
		shapeProps: THEME_CARD_SHAPE_PROPS,
		widgetProps: {
			viewMode: 'stack',
		},
	} ),
	getSummary: () => __( 'Theme' ),
	getLoadingShapeProps: () => THEME_CARD_SHAPE_PROPS,
	resolver: {
		resolve: async ( widget, context ) =>
			createThemeResolution( widget, await getThemeMaterials( context ) ),
		invalidate: () => false,
	},
} satisfies WidgetDefinition< ThemeWidget >;

export function createThemeResolution( widget: ThemeWidget, materials: ThemeMaterials ) {
	const widgets = createThemeMaterialWidgets( widget, materials );
	const stack: ResolvedDeskStack[] =
		widgets.length > 1
			? [
					{
						origin: {
							kind: 'derived' as const,
							sourceWidgetId: widget.id,
							key: 'theme-materials',
						},
						followSourceWidgetId: widget.id,
						stack: {
							id: getThemeMaterialsStackId( widget.id ),
							...getThemeStackPosition( widget ),
							zIndex: widget.zIndex,
							memberIds: widgets.map( ( resolvedWidget ) => resolvedWidget.widget.id ),
							...( widget.widgetProps.viewMode && widget.widgetProps.viewMode !== 'stack'
								? { viewMode: widget.widgetProps.viewMode }
								: {} ),
						},
					},
			  ]
			: [];

	return {
		identity: materials,
		widgets,
		stacks: stack,
	};
}

function createThemeMaterialWidgets(
	widget: ThemeWidget,
	materials: ThemeMaterials
): ThemeMaterialResolvedWidget[] {
	const positions = getThemeMaterialPositions( widget, getThemeMaterialCount( materials ) );
	let index = 0;
	const widgets: ThemeMaterialResolvedWidget[] = [];
	const sampleTemplate = pickSampleTemplate( materials.templates );

	if ( sampleTemplate ) {
		widgets.push(
			createDerivedThemeTemplateWidget( widget, sampleTemplate, positions[ index++ ] )
		);
	}

	widgets.push( createDerivedThemeStylesWidget( widget, materials, positions[ index++ ] ) );

	const headerPart = materials.patterns.find(
		( pattern ) => pattern.source === 'template-part' && pattern.area === 'header'
	);
	const footerPart = materials.patterns.find(
		( pattern ) => pattern.source === 'template-part' && pattern.area === 'footer'
	);
	for ( const templatePart of [ headerPart, footerPart ] ) {
		if ( templatePart ) {
			widgets.push( createDerivedThemePatternWidget( widget, templatePart, positions[ index++ ] ) );
		}
	}

	const samplePattern = materials.patterns.find( ( pattern ) => pattern.source === 'theme' );
	if ( samplePattern ) {
		widgets.push( createDerivedThemePatternWidget( widget, samplePattern, positions[ index++ ] ) );
	}

	return widgets;
}

function getThemeMaterialCount( materials: ThemeMaterials ) {
	let count = 1;
	if ( pickSampleTemplate( materials.templates ) ) {
		count += 1;
	}
	if (
		materials.patterns.some(
			( pattern ) => pattern.source === 'template-part' && pattern.area === 'header'
		)
	) {
		count += 1;
	}
	if (
		materials.patterns.some(
			( pattern ) => pattern.source === 'template-part' && pattern.area === 'footer'
		)
	) {
		count += 1;
	}
	if ( materials.patterns.some( ( pattern ) => pattern.source === 'theme' ) ) {
		count += 1;
	}
	return count;
}

function getThemeMaterialPositions( widget: ThemeWidget, count: number ) {
	const stackPosition = getThemeStackPosition( widget );
	if ( widget.widgetProps.viewMode !== 'tiles' ) {
		return Array.from( { length: count }, () => stackPosition );
	}

	const sizes = Array.from( { length: count }, () => THEME_MATERIAL_SHAPE_PROPS );
	const anchorCenter = {
		x: stackPosition.x + THEME_MATERIAL_SHAPE_PROPS.w / 2,
		y: stackPosition.y + THEME_MATERIAL_SHAPE_PROPS.h / 2,
	};
	return getStackTileLayoutsFromCenter( sizes, anchorCenter ).map( ( layout ) => ( {
		x: layout.x,
		y: layout.y,
	} ) );
}

function getThemeStackPosition( widget: ThemeWidget ) {
	return getThemeMaterialsStackPosition( widget );
}

function pickSampleTemplate( templates: ThemeTemplate[] ) {
	return (
		templates.find( ( template ) => template.slug === 'index' ) ??
		templates.find( ( template ) => template.slug === 'single' ) ??
		templates.find( ( template ) => template.slug === 'page' ) ??
		templates[ 0 ] ??
		null
	);
}

function createDerivedThemeTemplateWidget(
	source: ThemeWidget,
	template: ThemeTemplate,
	position: ThemeMaterialPosition
): ResolvedDeskWidget< ThemeTemplateWidget > {
	return {
		origin: {
			kind: 'derived',
			sourceWidgetId: source.id,
			key: `template:${ template.id }`,
		},
		widget: {
			id: `${ source.id }:template:${ template.slug || template.id }`,
			type: THEME_TEMPLATE_WIDGET_TYPE,
			x: position.x,
			y: position.y,
			...( position.rotation !== undefined ? { rotation: position.rotation } : {} ),
			zIndex: source.zIndex,
			shapeProps: THEME_MATERIAL_SHAPE_PROPS,
			widgetProps: {
				templateId: template.id,
				slug: template.slug,
				title: template.title,
				description: template.description,
				source: template.source,
			},
		},
	};
}

function createDerivedThemeStylesWidget(
	source: ThemeWidget,
	materials: ThemeMaterials,
	position: ThemeMaterialPosition
): ResolvedDeskWidget< ThemeStylesWidget > {
	return {
		origin: {
			kind: 'derived',
			sourceWidgetId: source.id,
			key: 'styles',
		},
		widget: {
			id: `${ source.id }:styles`,
			type: THEME_STYLES_WIDGET_TYPE,
			x: position.x,
			y: position.y,
			...( position.rotation !== undefined ? { rotation: position.rotation } : {} ),
			zIndex: source.zIndex,
			shapeProps: THEME_MATERIAL_SHAPE_PROPS,
			widgetProps: getThemeStylesWidgetProps( materials.styles ),
		},
	};
}

function createDerivedThemePatternWidget(
	source: ThemeWidget,
	pattern: ThemePattern,
	position: ThemeMaterialPosition
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
			shapeProps: THEME_MATERIAL_SHAPE_PROPS,
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
