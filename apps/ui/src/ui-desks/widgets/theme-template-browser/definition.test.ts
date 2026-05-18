import { describe, expect, it, vi } from 'vitest';
import { THEME_TEMPLATE_WIDGET_TYPE } from '../theme-template/types';
import {
	createThemeTemplateBrowserResolution,
	themeTemplateBrowserWidgetDefinition,
} from './definition';
import { THEME_TEMPLATE_BROWSER_WIDGET_TYPE, type ThemeTemplateBrowserWidget } from './types';
import type { ThemeTemplate } from '@/ui-desks/widgets/theme/api';

vi.mock( '@wordpress/icons', () => ( {
	page: {},
} ) );

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
} ) );

vi.mock( '@/ui-desks/widgets/theme-template-browser/component', () => ( {
	ThemeTemplateBrowserWidgetComponent: () => null,
	ThemeTemplateBrowserLoadingComponent: () => null,
	ThemeTemplateBrowserThumbnailComponent: () => null,
} ) );

describe( 'theme template browser widget definition', () => {
	it( 'is only spawned from theme-card actions', () => {
		expect( themeTemplateBrowserWidgetDefinition.isCreatable ).toBe( false );
		expect( themeTemplateBrowserWidgetDefinition.labels.add() ).toBe( 'Browse templates' );
	} );

	it( 'lays templates out from the most specific hierarchy level', () => {
		const browser = createTemplateBrowserWidget();
		const resolution = createThemeTemplateBrowserResolution( browser, createThemeTemplates() );

		expect( resolution.widgets.map( ( { widget } ) => widget.type ) ).toEqual( [
			THEME_TEMPLATE_WIDGET_TYPE,
			THEME_TEMPLATE_WIDGET_TYPE,
			THEME_TEMPLATE_WIDGET_TYPE,
			THEME_TEMPLATE_WIDGET_TYPE,
		] );
		expect( resolution.widgets.map( ( { widget } ) => widget.widgetProps.slug ) ).toEqual( [
			'single-post',
			'page',
			'single',
			'index',
		] );
		expect(
			resolution.widgets.map( ( { widget } ) => ( {
				slug: widget.widgetProps.slug,
				x: widget.x,
				y: widget.y,
			} ) )
		).toEqual( [
			{ slug: 'single-post', x: 100, y: 200 },
			{ slug: 'page', x: -70, y: 780 },
			{ slug: 'single', x: 270, y: 780 },
			{ slug: 'index', x: 100, y: 1360 },
		] );
	} );
} );

function createTemplateBrowserWidget(): ThemeTemplateBrowserWidget {
	return {
		id: 'templates-1',
		type: THEME_TEMPLATE_BROWSER_WIDGET_TYPE,
		x: 100,
		y: 200,
		zIndex: 'a1',
		shapeProps: {
			w: 1,
			h: 1,
		},
		widgetProps: {},
	};
}

function createThemeTemplates(): ThemeTemplate[] {
	return [
		{
			id: 'theme//index',
			slug: 'index',
			title: 'Index',
			description: '',
			theme: 'theme',
			source: 'theme',
		},
		{
			id: 'theme//single',
			slug: 'single',
			title: 'Single',
			description: '',
			theme: 'theme',
			source: 'theme',
		},
		{
			id: 'theme//single-post',
			slug: 'single-post',
			title: 'Single Post',
			description: '',
			theme: 'theme',
			source: 'theme',
		},
		{
			id: 'theme//page',
			slug: 'page',
			title: 'Page',
			description: '',
			theme: 'theme',
			source: 'custom',
		},
	];
}
