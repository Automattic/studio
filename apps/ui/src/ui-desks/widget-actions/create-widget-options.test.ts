import { describe, expect, it, vi } from 'vitest';
import { getThemeGlobalStyles } from '@/ui-desks/widgets/theme/api';
import { THEME_STYLES_WIDGET_TYPE } from '@/ui-desks/widgets/theme-styles/types';
import { getCreateWidgetOptions } from './create-widget-options';
import type { DeskWidgetDefinition } from '@/ui-desks/widgets/types';

vi.mock( '@/ui-desks/widgets/theme/api', () => ( {
	getThemeGlobalStyles: vi.fn(),
} ) );

const getThemeGlobalStylesMock = vi.mocked( getThemeGlobalStyles );

describe( 'getCreateWidgetOptions', () => {
	it( 'hydrates new style cards with active theme global styles', async () => {
		getThemeGlobalStylesMock.mockResolvedValue( {
			palette: [ { slug: 'primary', color: '#3858e9' } ],
			fontFamily: 'Inter, sans-serif',
			textColor: '#111111',
			backgroundColor: '#ffffff',
		} );

		const options = await getCreateWidgetOptions(
			{
				type: THEME_STYLES_WIDGET_TYPE,
				shouldStartEditingOnCreate: false,
			} as DeskWidgetDefinition,
			{} as never
		);

		expect( getThemeGlobalStylesMock ).toHaveBeenCalledWith( { registry: {} } );
		expect( options ).toMatchObject( {
			shouldStartEditing: false,
			widgetProps: {
				palette: [ { slug: 'primary', color: '#3858e9' } ],
				fontFamily: 'Inter, sans-serif',
			},
		} );
	} );
} );
