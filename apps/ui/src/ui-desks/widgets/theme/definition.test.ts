import { describe, expect, it, vi } from 'vitest';
import { THEME_PATTERN_WIDGET_TYPE } from '../theme-pattern/types';
import { THEME_STYLES_WIDGET_TYPE } from '../theme-styles/types';
import { THEME_TEMPLATE_WIDGET_TYPE } from '../theme-template/types';
import { createThemeResolution, themeWidgetDefinition } from './definition';
import { getThemeMaterialsStackId, THEME_WIDGET_TYPE, type ThemeWidget } from './types';
import type { ThemeMaterials } from './api';

vi.mock( '@wordpress/icons', () => ( {
	globe: {},
	layout: {},
	styles: {},
	typography: {},
} ) );

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
} ) );

vi.mock( '@/ui-desks/widgets/theme/component', () => ( {
	ThemeWidgetComponent: () => null,
	ThemeWidgetLoadingComponent: () => null,
	ThemeWidgetThumbnailComponent: () => null,
} ) );

vi.mock( '@/ui-desks/widgets/theme/site-url-control', () => ( {
	ThemeExploreControl: () => null,
	ThemeSiteUrlControl: () => () => null,
} ) );

describe( 'theme widget definition', () => {
	it( 'uses the reference theme toolbar controls', () => {
		expect( 'getEditAction' in themeWidgetDefinition ).toBe( false );
		expect( 'edit' in themeWidgetDefinition.labels ).toBe( false );
		expect( themeWidgetDefinition.controls?.map( ( control ) => control.id ) ).toEqual( [
			'theme-explore',
			'theme-font-library',
			'theme-styles',
			'theme-browser',
		] );
	} );

	it( 'resolves the theme material stack from active theme data', () => {
		const theme = createThemeWidget( { x: 100, y: 200 } );
		const resolution = createThemeResolution( theme, createThemeMaterials() );

		expect( themeWidgetDefinition.preserveSourceWidgetPosition ).toBe( true );
		expect( resolution.widgets.map( ( { widget } ) => widget.type ) ).toEqual( [
			THEME_TEMPLATE_WIDGET_TYPE,
			THEME_STYLES_WIDGET_TYPE,
			THEME_PATTERN_WIDGET_TYPE,
			THEME_PATTERN_WIDGET_TYPE,
			THEME_PATTERN_WIDGET_TYPE,
		] );
		expect( resolution.widgets[ 0 ]?.widget.widgetProps ).toMatchObject( {
			templateId: 'twentytwentyfive//index',
			slug: 'index',
		} );
		expect( resolution.stacks?.[ 0 ]?.stack.memberIds ).toEqual(
			resolution.widgets.map( ( { widget } ) => widget.id )
		);
		expect( resolution.stacks?.[ 0 ]?.stack.id ).toBe( getThemeMaterialsStackId( theme.id ) );
		expect( resolution.widgets.map( ( { widget } ) => ( { x: widget.x, y: widget.y } ) ) ).toEqual(
			Array.from( { length: 5 }, () => ( { x: 560, y: 340 } ) )
		);
	} );

	it( 'keeps tiled material positions stable when resolving from the stack center', () => {
		const theme = createThemeWidget( {
			x: 100,
			y: 200,
			widgetProps: {
				viewMode: 'tiles',
			},
		} );
		const initialResolution = createThemeResolution( theme, createThemeMaterials() );
		const initialPositions = initialResolution.widgets.map( ( { widget } ) => ( {
			x: widget.x,
			y: widget.y,
		} ) );
		expect( initialPositions ).toEqual( [
			{ x: 324, y: 252 },
			{ x: 560, y: 252 },
			{ x: 796, y: 252 },
			{ x: 324, y: 428 },
			{ x: 560, y: 428 },
		] );

		const reloadedTheme = {
			...theme,
			x: 100,
			y: 200,
		};
		const reloadedResolution = createThemeResolution( reloadedTheme, createThemeMaterials() );

		expect( reloadedResolution.stacks?.[ 0 ]?.stack.viewMode ).toBe( 'tiles' );
		expect(
			reloadedResolution.widgets.map( ( { widget } ) => ( { x: widget.x, y: widget.y } ) )
		).toEqual( initialPositions );
	} );
} );

function createThemeWidget( overrides: Partial< ThemeWidget > = {} ): ThemeWidget {
	const { widgetProps: widgetPropsOverrides, ...widgetOverrides } = overrides;

	return {
		id: 'theme-1',
		type: THEME_WIDGET_TYPE,
		x: 0,
		y: 0,
		zIndex: 'a1',
		shapeProps: {
			w: 760,
			h: 440,
		},
		...widgetOverrides,
		widgetProps: {
			viewMode: 'stack',
			...widgetPropsOverrides,
		},
	};
}

function createThemeMaterials(): ThemeMaterials {
	return {
		theme: {
			slug: 'twentytwentyfive',
			name: 'Twenty Twenty-Five',
			description: 'A block theme.',
			screenshot: 'http://example.com/screenshot.png',
			isBlockTheme: true,
		},
		styles: {
			palette: [
				{ slug: 'background', color: '#ffffff' },
				{ slug: 'foreground', color: '#111111' },
				{ slug: 'primary', color: '#3858e9' },
			],
			fontFamily: 'Manrope, sans-serif',
			textColor: '#111111',
			backgroundColor: '#ffffff',
		},
		templates: [
			{
				id: 'twentytwentyfive//404',
				slug: '404',
				title: '404',
				description: '',
				theme: 'twentytwentyfive',
				source: 'theme',
			},
			{
				id: 'twentytwentyfive//index',
				slug: 'index',
				title: 'Index',
				description: '',
				theme: 'twentytwentyfive',
				source: 'theme',
			},
		],
		patterns: [
			{
				source: 'template-part',
				id: 'twentytwentyfive//header',
				title: 'Header',
				content: '<!-- wp:group /-->',
				categories: [],
				area: 'header',
			},
			{
				source: 'template-part',
				id: 'twentytwentyfive//footer',
				title: 'Footer',
				content: '<!-- wp:group /-->',
				categories: [],
				area: 'footer',
			},
			{
				source: 'theme',
				id: 'twentytwentyfive/hero',
				title: 'Hero',
				content: '<!-- wp:cover /-->',
				categories: [],
			},
		],
	};
}
