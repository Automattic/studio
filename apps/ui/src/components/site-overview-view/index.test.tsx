import { fireEvent, render, screen } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteSettingsForm } from '@/components/site-settings-view';
import * as Tabs from '@/components/tabs';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useSites, useUpdateSite, useXdebugEnabledSite } from '@/data/queries/use-sites';
import { useThemeDetails } from '@/data/queries/use-theme-details';
import { useWordPressVersions, useWpVersion } from '@/data/queries/use-wordpress-versions';
import { useOffline } from '@/hooks/use-offline';
import { SiteOverviewView } from './index';
import type { SiteSettingsTabId } from '@/components/site-settings-view';
import type { SiteDetails } from '@/data/core';

const WP_VERSIONS = [
	{ label: '6.8', value: 'latest', isBeta: false, isDevelopment: false },
	{ label: '6.8', value: '6.8', isBeta: false, isDevelopment: false },
	{ label: '6.7.2', value: '6.7.2', isBeta: false, isDevelopment: false },
];

class ResizeObserverMock {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}

const openSiteUrlMock = vi.hoisted( () => vi.fn() );

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( {
		openExternalUrl: vi.fn(),
		copyText: vi.fn(),
	} ),
} ) );

vi.mock( '@/data/queries/use-create-site-helpers', () => ( {
	useExistingCustomDomains: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: vi.fn(),
	useUpdateSite: vi.fn(),
	useXdebugEnabledSite: vi.fn(),
	useIsSiteStarting: () => false,
	useIsSiteStopping: () => false,
} ) );

vi.mock( '@/components/agentic-signin-banner', () => ( {
	AgenticSigninBanner: () => <div>Sign in to use Studio Assistant</div>,
} ) );

vi.mock( '@/components/offline-banner', () => ( {
	OfflineBanner: () => null,
} ) );

vi.mock( '@/components/delete-site-dialog', () => ( {
	DeleteSiteDialog: () => null,
} ) );

vi.mock( '@/components/site-toolbar/publish-site-dialog', () => ( {
	PublishSiteDialog: () => null,
} ) );

vi.mock( '@/components/site-toolbar/sync-dialog', () => ( {
	SyncDialog: () => null,
} ) );

vi.mock( '@/components/open-in-menu/use-open-in-destinations', () => ( {
	useOpenInDestinations: () => [
		{ id: 'browser', label: 'Browser', logo: <span />, disabled: false, open: vi.fn() },
		{ id: 'files', label: 'Finder', logo: <span />, disabled: false, open: vi.fn() },
		{ id: 'editor', label: 'Cursor', logo: <span />, disabled: false, open: vi.fn() },
		{ id: 'terminal', label: 'Terminal', logo: <span />, disabled: false, open: vi.fn() },
	],
} ) );

vi.mock( '@/hooks/use-open-site-url', () => ( {
	useOpenSiteUrl: () => openSiteUrlMock,
} ) );

vi.mock( '@/hooks/use-site-management-actions', () => ( {
	useSiteManagementActions: () => [],
} ) );

vi.mock( '@/data/queries/use-connected-wpcom-sites', () => ( {
	useConnectedWpcomSites: () => ( {
		data: [
			{
				id: 42,
				localSiteId: 'site-1',
				name: 'Demo Production',
				url: 'https://example.com',
				isStaging: false,
				isPressable: false,
				syncSupport: 'already-connected',
				lastPushTimestamp: '2026-08-01T12:00:00.000Z',
				lastPullTimestamp: null,
			},
		],
	} ),
} ) );

vi.mock( '@/data/queries/use-sync-site', () => ( {
	usePushSiteToLive: () => ( { isPending: false, mutate: vi.fn() } ),
	usePullSiteFromLive: () => ( { isPending: false, mutate: vi.fn() } ),
} ) );

vi.mock( '@/data/sync-activity', () => ( {
	useSiteSyncActivity: () => null,
} ) );

vi.mock( '@/data/queries/use-wordpress-versions', () => ( {
	useWordPressVersions: vi.fn(),
	useWpVersion: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-theme-details', () => ( {
	useThemeDetails: vi.fn(),
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: vi.fn(),
} ) );

const useExistingCustomDomainsMock = vi.mocked( useExistingCustomDomains, { partial: true } );
const useSitesMock = vi.mocked( useSites, { partial: true } );
const useUpdateSiteMock = vi.mocked( useUpdateSite, { partial: true } );
const useOfflineMock = vi.mocked( useOffline );
const useWordPressVersionsMock = vi.mocked( useWordPressVersions, { partial: true } );
const useWpVersionMock = vi.mocked( useWpVersion, { partial: true } );
const useThemeDetailsMock = vi.mocked( useThemeDetails, { partial: true } );
const useXdebugEnabledSiteMock = vi.mocked( useXdebugEnabledSite, { partial: true } );

describe( 'SiteOverviewView', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.stubGlobal( 'ResizeObserver', ResizeObserverMock );
		Object.defineProperty( window, 'matchMedia', {
			writable: true,
			value: vi.fn().mockImplementation( ( query: string ) => ( {
				matches: false,
				media: query,
				onchange: null,
				addListener: vi.fn(),
				removeListener: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
			} ) ),
		} );

		useExistingCustomDomainsMock.mockReturnValue( [] );
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: true } ) ],
			isLoading: false,
		} );
		useUpdateSiteMock.mockReturnValue( { isPending: false, mutate: vi.fn() } );
		useOfflineMock.mockReturnValue( false );
		useWordPressVersionsMock.mockReturnValue( { data: undefined } );
		useWpVersionMock.mockReturnValue( { data: undefined } );
		useThemeDetailsMock.mockImplementation( ( site ) => ( { data: site.themeDetails } ) );
		useXdebugEnabledSiteMock.mockReturnValue( null );
	} );

	function renderView( activeTab: SiteSettingsTabId | 'overview' = 'general' ) {
		return render(
			<Tooltip.Provider>
				<Tabs.Root selectedTabId={ activeTab }>
					<SiteOverviewView siteId="site-1" activeTab={ activeTab } />
				</Tabs.Root>
			</Tooltip.Provider>
		);
	}

	it( 'restores the familiar site overview actions', () => {
		useWpVersionMock.mockReturnValue( { data: '6.9' } );
		renderView( 'overview' );

		expect( screen.getByText( 'Sign in to use Studio Assistant' ) ).toBeVisible();
		expect( screen.getByText( 'Twenty Twenty-Six' ) ).toBeVisible();
		expect( screen.getByText( 'Block theme' ) ).toBeVisible();
		expect( screen.getByText( '1.2.0' ) ).toBeVisible();
		expect( screen.getByText( '12' ) ).toBeVisible();
		expect( screen.getByText( '8' ) ).toBeVisible();
		expect( screen.getByText( '6.9' ) ).toBeVisible();
		expect( screen.getByText( 'example.com' ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'Theme' } ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'Environment' } ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'Connections' } ) ).toBeVisible();
		expect( screen.getByText( 'Native PHP' ) ).toBeVisible();
		expect( screen.getByText( 'SQLite' ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'Customize' } ) ).toBeVisible();
		for ( const label of [
			'Site Editor',
			'Styles',
			'Patterns',
			'Navigation',
			'Templates',
			'Pages',
		] ) {
			expect( screen.getByRole( 'button', { name: label } ) ).toBeVisible();
		}
		expect( screen.getByRole( 'heading', { name: 'Open in…' } ) ).toBeVisible();
		for ( const label of [ 'Browser', 'Finder', 'Cursor', 'Terminal', 'phpMyAdmin' ] ) {
			expect( screen.getByRole( 'button', { name: label } ) ).toBeVisible();
		}
		expect( screen.getByRole( 'heading', { name: 'Manage' } ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'phpMyAdmin' } ) );
		expect( openSiteUrlMock ).toHaveBeenCalledWith(
			'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
		);
	} );

	it( 'renders the settings form with save actions on the general tab', () => {
		renderView( 'general' );

		expect( screen.getByDisplayValue( 'Demo Site' ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'Debugging' } ) ).toBeVisible();
		expect( screen.getByRole( 'checkbox', { name: 'Enable Xdebug' } ) ).toBeVisible();
		expect( screen.getByRole( 'checkbox', { name: 'Enable debug log' } ) ).toBeVisible();
		expect( screen.getByRole( 'checkbox', { name: 'Show errors in browser' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Save settings' } ) ).toBeVisible();
	} );

	it( 'does not show Settings save actions on the Connections tab', () => {
		render(
			<Tooltip.Provider>
				<Tabs.Root selectedTabId="connections">
					<SiteSettingsForm site={ createSite() } />
				</Tabs.Root>
			</Tooltip.Provider>
		);

		expect( screen.queryByRole( 'button', { name: 'Save settings' } ) ).not.toBeInTheDocument();
	} );

	it( 'renders the WordPress version dropdown with latest preselected for auto-updating sites', () => {
		useWordPressVersionsMock.mockReturnValue( { data: WP_VERSIONS } );

		renderView( 'general' );

		const select = screen.getByLabelText( 'WordPress version' );
		expect( select.tagName ).toBe( 'SELECT' );
		expect( select ).toHaveValue( '' );
		expect( screen.getByRole( 'option', { name: '6.7.2' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'group', { name: 'Auto-updating' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'group', { name: 'Stable Versions' } ) ).toBeInTheDocument();
	} );

	it( 'saves a pinned WordPress version picked from the dropdown', () => {
		const updateSiteMutate = vi.fn();
		useUpdateSiteMock.mockReturnValue( { isPending: false, mutate: updateSiteMutate } );
		useWordPressVersionsMock.mockReturnValue( { data: WP_VERSIONS } );

		renderView( 'general' );

		fireEvent.change( screen.getByLabelText( 'WordPress version' ), {
			target: { value: '6.7.2' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save settings' } ) );

		expect( updateSiteMutate ).toHaveBeenCalledWith(
			expect.objectContaining( {
				site: expect.objectContaining( { isWpAutoUpdating: false } ),
				wpVersion: '6.7.2',
			} ),
			expect.anything()
		);
	} );

	it( 'shows the installed version for pinned sites, adding it to the list when missing', () => {
		useWpVersionMock.mockReturnValue( { data: '6.5.2' } );
		useWordPressVersionsMock.mockReturnValue( { data: WP_VERSIONS } );
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: true, isWpAutoUpdating: false } ) ],
			isLoading: false,
		} );

		renderView( 'general' );

		const select = screen.getByLabelText( 'WordPress version' );
		expect( select ).toHaveValue( '6.5.2' );
		expect( screen.getByRole( 'option', { name: '6.5.2' } ) ).toBeInTheDocument();
	} );

	it( 'does not forward the version when saving unrelated changes on a pinned site', () => {
		const updateSiteMutate = vi.fn();
		useUpdateSiteMock.mockReturnValue( { isPending: false, mutate: updateSiteMutate } );
		useWpVersionMock.mockReturnValue( { data: '6.5.2' } );
		useWordPressVersionsMock.mockReturnValue( { data: WP_VERSIONS } );
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: true, isWpAutoUpdating: false } ) ],
			isLoading: false,
		} );

		renderView( 'general' );

		fireEvent.change( screen.getByDisplayValue( 'Demo Site' ), {
			target: { value: 'Renamed Site' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save settings' } ) );

		expect( updateSiteMutate ).toHaveBeenCalledWith(
			expect.objectContaining( {
				site: expect.objectContaining( { name: 'Renamed Site', isWpAutoUpdating: false } ),
				wpVersion: undefined,
			} ),
			expect.anything()
		);
	} );

	// Editing a site restarts it, and the restart events refresh the site while
	// the CLI is still applying the edit — the version on disk is still the old
	// one at that point, so the form must not re-seed from it.
	it( 'keeps the picked version while the save restarts the site', () => {
		useUpdateSiteMock.mockReturnValue( { isPending: true, mutate: vi.fn() } );
		useWpVersionMock.mockReturnValue( { data: '6.8' } );
		useWordPressVersionsMock.mockReturnValue( { data: WP_VERSIONS } );
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: true, isWpAutoUpdating: false } ) ],
			isLoading: false,
		} );

		const { rerender } = renderView( 'general' );

		fireEvent.change( screen.getByLabelText( 'WordPress version' ), {
			target: { value: '6.7.2' },
		} );

		// A restart event refreshes the site list mid-save.
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: false, isWpAutoUpdating: false } ) ],
			isLoading: false,
		} );
		rerender(
			<Tooltip.Provider>
				<Tabs.Root selectedTabId="general">
					<SiteOverviewView siteId="site-1" activeTab="general" />
				</Tabs.Root>
			</Tooltip.Provider>
		);

		expect( screen.getByLabelText( 'WordPress version' ) ).toHaveValue( '6.7.2' );
	} );

	it( 'keeps a pinned site pinned when saving other settings while offline', () => {
		const updateSiteMutate = vi.fn();
		useOfflineMock.mockReturnValue( true );
		useUpdateSiteMock.mockReturnValue( { isPending: false, mutate: updateSiteMutate } );
		useWpVersionMock.mockReturnValue( { data: '6.5.2' } );
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: true, isWpAutoUpdating: false } ) ],
			isLoading: false,
		} );

		renderView( 'general' );

		fireEvent.change( screen.getByDisplayValue( 'Demo Site' ), {
			target: { value: 'Renamed Site' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save settings' } ) );

		expect( updateSiteMutate ).toHaveBeenCalledWith(
			expect.objectContaining( {
				site: expect.objectContaining( { name: 'Renamed Site', isWpAutoUpdating: false } ),
				wpVersion: undefined,
			} ),
			expect.anything()
		);
	} );

	it( 'keeps the version field a dropdown when the version list is unavailable', () => {
		renderView( 'general' );

		const select = screen.getByLabelText( 'WordPress version' );
		expect( select.tagName ).toBe( 'SELECT' );
		expect( select ).toHaveValue( '' );
	} );

	// Offline only blocks *changing* the version, so the field stays on the
	// site's real version rather than misreporting it as auto-updating.
	it( 'disables the version dropdown while offline without changing its value', async () => {
		useOfflineMock.mockReturnValue( true );
		useWpVersionMock.mockReturnValue( { data: '6.5.2' } );
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: true, isWpAutoUpdating: false } ) ],
			isLoading: false,
		} );

		renderView( 'general' );

		const select = screen.getByLabelText( 'WordPress version' );
		expect( select.tagName ).toBe( 'SELECT' );
		expect( select ).toBeDisabled();
		expect( select ).toHaveValue( '6.5.2' );

		const trigger = select.closest( 'div[style*="pointer-events"]' )?.parentElement as HTMLElement;
		fireEvent.mouseEnter( trigger );
		fireEvent.mouseMove( trigger, { movementX: 1, movementY: 1 } );
		// Tooltips use Base UI's default open delay, so wait long enough for the popup.
		expect(
			await screen.findByText(
				'Changing WordPress version requires an internet connection.',
				{},
				{ timeout: 2000 }
			)
		).toBeVisible();
	} );

	it( 'lets a pinned site switch back to auto-updating', () => {
		const updateSiteMutate = vi.fn();
		useUpdateSiteMock.mockReturnValue( { isPending: false, mutate: updateSiteMutate } );
		useWordPressVersionsMock.mockReturnValue( { data: WP_VERSIONS } );
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: true, isWpAutoUpdating: false } ) ],
			isLoading: false,
		} );

		renderView( 'general' );

		const select = screen.getByLabelText( 'WordPress version' );
		expect( select ).toHaveValue( 'latest' );

		fireEvent.change( select, { target: { value: '' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save settings' } ) );

		// 'latest' has to reach the CLI so it actually installs the newest
		// release — forwarding nothing would leave the site on its pinned files.
		expect( updateSiteMutate ).toHaveBeenCalledWith(
			expect.objectContaining( {
				site: expect.objectContaining( { isWpAutoUpdating: true } ),
				wpVersion: 'latest',
			} ),
			expect.anything()
		);
	} );

	it( 'shows a not-found state for unknown sites', () => {
		render( <SiteOverviewView siteId="missing-site" activeTab="general" /> );

		expect( screen.getByRole( 'heading', { name: 'Site not found' } ) ).toBeVisible();
	} );
} );

function createSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	return {
		id: 'site-1',
		name: 'Demo Site',
		path: '/Users/example/Studio/demo-site',
		port: 8881,
		running: false,
		phpVersion: '8.4',
		adminUsername: 'admin',
		adminEmail: 'admin@example.com',
		enableDebugLog: true,
		themeDetails: {
			name: 'Twenty Twenty-Six',
			path: '/wp-content/themes/twentytwentysix',
			slug: 'twentytwentysix',
			version: '1.2.0',
			homepage: 'https://wordpress.org/themes/twentytwentysix/',
			isBlockTheme: true,
			templateCount: 12,
			patternCount: 8,
			modifiedAt: '2026-08-01T12:00:00Z',
		},
		...overrides,
	};
}
