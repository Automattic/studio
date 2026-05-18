import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRegistry } from '@wordpress/data';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import { useDesk } from '@/ui-desks/desk/provider';
import { getThemePatterns, getThemeTemplates } from '@/ui-desks/widgets/theme/api';
import { useActiveTheme } from '@/ui-desks/widgets/theme/use-active-theme';
import { ThemeExploreControl, ThemeSiteUrlControl } from './site-url-control';
import { THEME_WIDGET_TYPE, type ThemeWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

vi.mock( '@wordpress/data', () => ( {
	useRegistry: vi.fn(),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: vi.fn(),
} ) );

vi.mock( '@/ui-desks/desk/provider', () => ( {
	useDesk: vi.fn(),
} ) );

vi.mock( '@/ui-desks/widgets/theme/api', () => ( {
	getThemePatterns: vi.fn(),
	getThemeTemplates: vi.fn(),
} ) );

vi.mock( '@/ui-desks/widgets/theme/use-active-theme', () => ( {
	useActiveTheme: vi.fn(),
} ) );

const useRegistryMock = vi.mocked( useRegistry );
const useConnectorMock = vi.mocked( useConnector );
const useSitesMock = vi.mocked( useSites );
const useDeskMock = vi.mocked( useDesk );
const getThemePatternsMock = vi.mocked( getThemePatterns );
const getThemeTemplatesMock = vi.mocked( getThemeTemplates );
const useActiveThemeMock = vi.mocked( useActiveTheme );

describe( 'ThemeSiteUrlControl', () => {
	const openSiteUrl = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		openSiteUrl.mockResolvedValue( undefined );
		useRegistryMock.mockReturnValue( {} as never );
		getThemePatternsMock.mockResolvedValue( createThemePatterns() );
		getThemeTemplatesMock.mockResolvedValue( createThemeTemplates() );
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

	it( 'shows temporary theme template and pattern browsers from the selected theme card', async () => {
		const toggleTemporaryDesk = vi.fn( () => true );
		useDeskMock.mockReturnValue( {
			siteId: 'site-1',
			canAddWidgets: true,
			selectedWidgetToolbarItem: {
				kind: 'single-widget',
				widget: createThemeWidget(),
			},
			isTemporaryDeskVisible: () => false,
			toggleTemporaryDesk,
		} as never );

		render( <ThemeExploreControl { ...createControlContext() } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Explore theme' } ) );

		await waitFor( () => expect( toggleTemporaryDesk ).toHaveBeenCalledTimes( 2 ) );
		expect( getThemeTemplatesMock ).toHaveBeenCalledWith( { registry: {} } );
		expect( getThemePatternsMock ).toHaveBeenCalledWith( { registry: {} } );
		expect( toggleTemporaryDesk ).toHaveBeenCalledWith(
			expect.objectContaining( {
				id: 'theme-template-browser:theme-1:template-browser',
				sourceWidgetId: 'theme-1',
				followSource: true,
				widgets: [
					expect.objectContaining( {
						id: 'theme-1:template-browser:template:index',
						type: 'theme-template',
						x: 856,
						y: 100,
					} ),
				],
			} )
		);
		expect( toggleTemporaryDesk ).toHaveBeenCalledWith(
			expect.objectContaining( {
				id: 'theme-pattern-browser:theme-1:pattern-browser',
				sourceWidgetId: 'theme-1',
				followSource: true,
				widgets: [
					expect.objectContaining( {
						id: 'theme-1:pattern-browser:theme:theme/hero',
						type: 'theme-pattern',
						x: 100,
						y: 636,
					} ),
				],
			} )
		);
	} );

	it( 'closes temporary theme browsers without refetching theme materials', () => {
		const toggleTemporaryDesk = vi.fn( () => true );
		useDeskMock.mockReturnValue( {
			siteId: 'site-1',
			canAddWidgets: true,
			selectedWidgetToolbarItem: {
				kind: 'single-widget',
				widget: createThemeWidget(),
			},
			isTemporaryDeskVisible: ( id: string ) =>
				id === 'theme-template-browser:theme-1:template-browser',
			toggleTemporaryDesk,
		} as never );

		render( <ThemeExploreControl { ...createControlContext() } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Explore theme' } ) );

		expect( getThemeTemplatesMock ).not.toHaveBeenCalled();
		expect( getThemePatternsMock ).not.toHaveBeenCalled();
		expect( toggleTemporaryDesk ).toHaveBeenCalledWith(
			expect.objectContaining( {
				id: 'theme-template-browser:theme-1:template-browser',
				widgets: [],
			} )
		);
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

function createThemeWidget() {
	return {
		id: 'theme-1',
		type: THEME_WIDGET_TYPE,
		x: 100,
		y: 100,
		zIndex: 'a1',
		shapeProps: {
			w: 660,
			h: 440,
		},
		widgetProps: {
			viewMode: 'stack',
		},
	};
}

function createThemeTemplates() {
	return [
		{
			id: 'theme//index',
			slug: 'index',
			title: 'Index',
			description: '',
			theme: 'theme',
			source: 'theme' as const,
		},
	];
}

function createThemePatterns() {
	return [
		{
			source: 'theme' as const,
			id: 'theme/hero',
			title: 'Hero',
			content: '<!-- wp:cover /-->',
			categories: [],
		},
	];
}
