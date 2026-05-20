import { describe, expect, it } from 'vitest';
import { COLOR_WIDGET_TYPE } from '@/ui-desks/widgets/color/types';
import {
	createThemeStylesPaletteTemporaryDesk,
	getColorPaletteEntries,
	getThemeStylesPaletteTemporaryDeskId,
} from './palette-editor';
import { THEME_STYLES_WIDGET_TYPE, type ThemeStylesWidget } from './types';

describe( 'theme styles palette desk fragment', () => {
	it( 'creates a temporary circular color stack connected to the styles widget', () => {
		const sourceWidget = createThemeStylesWidget();
		const temporaryDesk = createThemeStylesPaletteTemporaryDesk( sourceWidget );

		expect( temporaryDesk ).toMatchObject( {
			id: getThemeStylesPaletteTemporaryDeskId( sourceWidget.id ),
			stacks: [
				{
					viewMode: 'circle',
					memberIds: [
						'theme-styles-palette:styles-1:color:primary:0',
						'theme-styles-palette:styles-1:color:accent:1',
					],
				},
			],
			connectors: [
				{
					from: { widgetId: sourceWidget.id },
					to: { widgetId: 'theme-styles-palette:styles-1:color:primary:0' },
					appearance: {
						dash: 'solid',
						arrowheadStart: 'none',
						arrowheadEnd: 'none',
					},
				},
			],
		} );
		expect( temporaryDesk?.widgets ).toHaveLength( 2 );
		expect( temporaryDesk?.widgets[ 0 ] ).toMatchObject( {
			type: COLOR_WIDGET_TYPE,
			widgetProps: {
				color: '#3858e9',
				title: 'Primary',
			},
		} );
	} );

	it( 'falls back to base colors when every palette entry is otherwise omitted', () => {
		expect(
			getColorPaletteEntries( [
				{ slug: 'background', color: '#ffffff' },
				{ slug: 'base', color: '#111111' },
			] )
		).toHaveLength( 2 );
	} );
} );

function createThemeStylesWidget(): ThemeStylesWidget {
	return {
		id: 'styles-1',
		type: THEME_STYLES_WIDGET_TYPE,
		x: 100,
		y: 120,
		zIndex: 'a1',
		shapeProps: {
			w: 220,
			h: 160,
		},
		widgetProps: {
			palette: [
				{ slug: 'background', color: '#ffffff' },
				{ slug: 'primary', name: 'Primary', color: '#3858e9' },
				{ slug: 'accent', name: 'Accent', color: '#f97316' },
			],
			fontFamily: 'Inter, sans-serif',
			textColor: '#111111',
			backgroundColor: '#ffffff',
		},
	};
}
