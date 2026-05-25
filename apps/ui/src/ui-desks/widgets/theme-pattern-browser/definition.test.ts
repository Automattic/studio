import { describe, expect, it, vi } from 'vitest';
import { THEME_PATTERN_WIDGET_TYPE } from '../theme-pattern/types';
import {
	createThemePatternBrowserMaterialization,
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
	it( 'is materialized by the top-level create menu action', () => {
		expect( themePatternBrowserWidgetDefinition.isCreatable ).toBe( false );
		expect( themePatternBrowserWidgetDefinition.labels.add() ).toBe( 'Browse patterns' );
		expect( themePatternBrowserWidgetDefinition.requiresRunningSite ).toBe( true );
		expect( themePatternBrowserWidgetDefinition.shouldStartEditingOnCreate ).toBe( false );
	} );

	it( 'materializes browsable pattern cards as persisted stack members', () => {
		const materialization = createThemePatternBrowserMaterialization(
			{
				center: { x: 500, y: 400 },
				zIndex: 'a1',
			},
			createThemePatterns()
		);
		if ( ! materialization ) {
			throw new Error( 'Expected pattern materialization.' );
		}

		expect( materialization.widgets.map( ( widget ) => widget.widgetProps.patternId ) ).toEqual( [
			'theme//header',
			'7',
			'theme/hero',
			'theme/gallery',
		] );
		expect( materialization.widgets.map( ( widget ) => ( { x: widget.x, y: widget.y } ) ) ).toEqual(
			Array.from( { length: 4 }, () => ( { x: 340, y: 290 } ) )
		);
		expect( materialization.stacks?.[ 0 ] ).toMatchObject( {
			x: 340,
			y: 290,
			zIndex: 'a1',
			memberIds: materialization.widgets.map( ( widget ) => widget.id ),
		} );
		expect( materialization.stacks?.[ 0 ] ).not.toHaveProperty( 'viewMode' );
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
