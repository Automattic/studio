import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import { useDesk } from '@/ui-desks/desk/provider';
import { useActiveTheme } from '@/ui-desks/widgets/theme/use-active-theme';
import { ThemeSiteUrlControl } from './site-url-control';
import type { ThemeWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: vi.fn(),
} ) );

vi.mock( '@/ui-desks/desk/provider', () => ( {
	useDesk: vi.fn(),
} ) );

vi.mock( '@/ui-desks/widgets/theme/use-active-theme', () => ( {
	useActiveTheme: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useSitesMock = vi.mocked( useSites );
const useDeskMock = vi.mocked( useDesk );
const useActiveThemeMock = vi.mocked( useActiveTheme );

describe( 'ThemeSiteUrlControl', () => {
	const openSiteUrl = vi.fn();

	beforeEach( () => {
		openSiteUrl.mockResolvedValue( undefined );
		useActiveThemeMock.mockReset();
		useActiveThemeMock.mockReturnValue( null );
		useConnectorMock.mockReturnValue( {
			openSiteUrl,
		} as never );
		useDeskMock.mockReturnValue( {
			siteId: 'site-1',
		} as never );
		useSitesMock.mockReturnValue( {
			data: [
				{
					id: 'site-1',
					themeDetails: {
						isBlockTheme: true,
					},
				},
			],
		} as never );
	} );

	it( 'opens the font library admin page without checking the theme type', () => {
		const FontLibraryControl = ThemeSiteUrlControl( {
			icon: {} as never,
			label: 'Font library',
			path: '/wp-admin/admin.php?page=font-library-wp-admin',
		} );

		render( <FontLibraryControl { ...createControlContext() } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Font library' } ) );

		expect( useActiveThemeMock ).toHaveBeenCalledWith( false );
		expect( openSiteUrl ).toHaveBeenCalledWith(
			'site-1',
			'/wp-admin/admin.php?page=font-library-wp-admin'
		);
	} );

	it( 'shows block-theme-only controls for block themes', async () => {
		const StylesControl = ThemeSiteUrlControl( {
			icon: {} as never,
			label: 'Styles',
			path: '/wp-admin/site-editor.php?path=%2Fwp_global_styles',
			requiresBlockTheme: true,
		} );

		render( <StylesControl { ...createControlContext() } /> );

		fireEvent.click( await screen.findByRole( 'button', { name: 'Styles' } ) );

		expect( useActiveThemeMock ).toHaveBeenCalledWith( false );
		expect( openSiteUrl ).toHaveBeenCalledWith(
			'site-1',
			'/wp-admin/site-editor.php?path=%2Fwp_global_styles'
		);
	} );

	it( 'hides block-theme-only controls for classic themes', async () => {
		useSitesMock.mockReturnValue( {
			data: [
				{
					id: 'site-1',
					themeDetails: {
						isBlockTheme: false,
					},
				},
			],
		} as never );
		const StylesControl = ThemeSiteUrlControl( {
			icon: {} as never,
			label: 'Styles',
			path: '/wp-admin/site-editor.php?path=%2Fwp_global_styles',
			requiresBlockTheme: true,
		} );

		const { container } = render( <StylesControl { ...createControlContext() } /> );

		expect( container ).toBeEmptyDOMElement();
		expect( useActiveThemeMock ).toHaveBeenCalledWith( false );
		expect( screen.queryByRole( 'button', { name: 'Styles' } ) ).not.toBeInTheDocument();
	} );

	it( 'falls back to active theme metadata when site theme details are unavailable', async () => {
		useSitesMock.mockReturnValue( { data: [ { id: 'site-1' } ] } as never );
		useActiveThemeMock.mockReturnValue( createActiveTheme( { isBlockTheme: true } ) );
		const StylesControl = ThemeSiteUrlControl( {
			icon: {} as never,
			label: 'Styles',
			path: '/wp-admin/site-editor.php?path=%2Fwp_global_styles',
			requiresBlockTheme: true,
		} );

		render( <StylesControl { ...createControlContext() } /> );

		expect( await screen.findByRole( 'button', { name: 'Styles' } ) ).toBeInTheDocument();
		expect( useActiveThemeMock ).toHaveBeenCalledWith( true );
	} );
} );

function createControlContext(): ControlRenderContext< ThemeWidgetProps > {
	return {
		isOpen: false,
		setIsOpen: vi.fn(),
		updateProps: vi.fn(),
		props: {},
	};
}

function createActiveTheme( overrides: { isBlockTheme: boolean } ) {
	return {
		slug: 'twentytwentyfive',
		name: 'Twenty Twenty-Five',
		description: '',
		screenshot: '',
		...overrides,
	};
}
