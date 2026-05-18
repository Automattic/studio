import { describe, expect, it, vi } from 'vitest';
import { THEME_PATTERN_WIDGET_TYPE } from '../theme-pattern/types';
import {
	createThemePatternBrowserResolution,
	themePatternBrowserWidgetDefinition,
} from './definition';
import { THEME_PATTERN_BROWSER_WIDGET_TYPE, type ThemePatternBrowserWidget } from './types';
import type { ThemePattern } from '@/ui-desks/widgets/theme/api';

vi.mock( '@wordpress/icons', () => ( {
	blockDefault: {},
	category: {},
} ) );

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
} ) );

vi.mock( '@/ui-desks/widgets/theme-pattern-browser/component', () => ( {
	ThemePatternBrowserWidgetComponent: () => null,
	ThemePatternBrowserLoadingComponent: () => null,
	ThemePatternBrowserThumbnailComponent: () => null,
} ) );

describe( 'theme pattern browser widget definition', () => {
	it( 'is only spawned from theme-card actions', () => {
		expect( themePatternBrowserWidgetDefinition.isCreatable ).toBe( false );
		expect( themePatternBrowserWidgetDefinition.labels.add() ).toBe( 'Browse patterns' );
	} );

	it( 'prioritizes template parts and reusable blocks before theme patterns', () => {
		const browser = createPatternBrowserWidget();
		const resolution = createThemePatternBrowserResolution( browser, createThemePatterns() );

		expect( resolution.widgets.map( ( { widget } ) => widget.type ) ).toEqual( [
			THEME_PATTERN_WIDGET_TYPE,
			THEME_PATTERN_WIDGET_TYPE,
			THEME_PATTERN_WIDGET_TYPE,
		] );
		expect( resolution.widgets.map( ( { widget } ) => widget.widgetProps.patternId ) ).toEqual( [
			'theme//header',
			'7',
			'theme/hero',
		] );
		expect( resolution.stacks?.[ 0 ]?.stack ).toMatchObject( {
			id: `theme-pattern-browser:${ browser.id }:patterns`,
			viewMode: 'tiles',
			memberIds: resolution.widgets.map( ( { widget } ) => widget.id ),
		} );
	} );
} );

function createPatternBrowserWidget(): ThemePatternBrowserWidget {
	return {
		id: 'patterns-1',
		type: THEME_PATTERN_BROWSER_WIDGET_TYPE,
		x: 100,
		y: 200,
		zIndex: 'a1',
		shapeProps: {
			w: 1,
			h: 1,
		},
		widgetProps: {
			limit: 3,
			viewMode: 'tiles',
		},
	};
}

function createThemePatterns(): ThemePattern[] {
	return [
		{
			source: 'theme',
			id: 'theme/hero',
			title: 'Hero',
			content: '<!-- wp:cover /-->',
			categories: [],
		},
		{
			source: 'theme',
			id: 'theme/gallery',
			title: 'Gallery',
			content: '<!-- wp:gallery /-->',
			categories: [],
		},
		{
			source: 'template-part',
			id: 'theme//header',
			title: 'Header',
			content: '<!-- wp:group /-->',
			categories: [],
			area: 'header',
		},
		{
			source: 'reusable',
			id: '7',
			title: 'Reusable CTA',
			content: '<!-- wp:buttons /-->',
			categories: [],
			blockId: 7,
		},
	];
}
