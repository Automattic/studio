import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
} from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useDesk } from '@/ui-desks/desk/provider';
import { SiteShortcutsWidgetComponent } from './index';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: vi.fn(),
	useStartSite: vi.fn(),
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@/ui-desks/desk/provider', () => ( {
	useDesk: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useSitesMock = vi.mocked( useSites );
const useStartSiteMock = vi.mocked( useStartSite );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useUserPreferencesMock = vi.mocked( useUserPreferences );
const useDeskMock = vi.mocked( useDesk );

describe( 'SiteShortcutsWidgetComponent', () => {
	const openSiteUrl = vi.fn();
	const startSite = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		openSiteUrl.mockResolvedValue( undefined );
		startSite.mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			openSiteUrl,
			openSiteFolder: vi.fn(),
			openSiteInEditor: vi.fn(),
			openSiteInTerminal: vi.fn(),
		} as never );
		useDeskMock.mockReturnValue( { siteId: 'site-1' } as never );
		useStartSiteMock.mockReturnValue( {
			isPending: false,
			mutateAsync: startSite,
		} as never );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
		useUserPreferencesMock.mockReturnValue( {
			data: {
				editor: 'zed',
				terminal: 'terminal',
				colorScheme: 'system',
				messageSendShortcut: 'mod-enter',
				locale: undefined,
			},
		} as never );
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: true } ) ],
		} as never );
	} );

	it( 'opens WordPress admin links for the current desk site', async () => {
		renderSiteShortcuts();

		expect( screen.queryByText( 'Demo Site' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'localhost:8881' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Running' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'WP Admin' } ) );

		await waitFor( () => {
			expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/' );
		} );
		expect( startSite ).not.toHaveBeenCalled();
		expect( screen.getByRole( 'button', { name: 'Zed' } ) ).toBeEnabled();
	} );

	it( 'starts stopped sites before opening WordPress shortcuts', async () => {
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: false } ) ],
		} as never );
		renderSiteShortcuts();

		fireEvent.click( screen.getByRole( 'button', { name: 'phpMyAdmin' } ) );

		await waitFor( () => {
			expect( startSite ).toHaveBeenCalledWith( 'site-1' );
			expect( openSiteUrl ).toHaveBeenCalledWith(
				'site-1',
				'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
			);
		} );
	} );
} );

function renderSiteShortcuts() {
	render(
		<SiteShortcutsWidgetComponent
			id="shortcuts-1"
			widgetProps={ {} }
			isEditing={ false }
			isHovered={ false }
			isSelected={ false }
			onWidgetPropsChange={ vi.fn() }
			onEditComplete={ vi.fn() }
		/>
	);
}

function createSite( overrides: { running: boolean } ) {
	return {
		id: 'site-1',
		name: 'Demo Site',
		path: '/Users/example/Studio/demo',
		port: 8881,
		running: overrides.running,
		phpVersion: '8.4',
		themeDetails: {
			name: 'Twenty Twenty-Six',
			path: 'twentytwentysix',
			slug: 'twentytwentysix',
			isBlockTheme: true,
		},
	};
}
