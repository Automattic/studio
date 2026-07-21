import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useLogin } from '@/data/queries/use-auth-user';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import {
	useCopySite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
	useUpdateSite,
	useXdebugEnabledSite,
} from '@/data/queries/use-sites';
import { useWordPressVersions, useWpVersion } from '@/data/queries/use-wordpress-versions';
import { SiteOverviewView } from './index';
import type { SiteDetails } from '@/data/core';

const navigateMock = vi.fn();
const siteDropdownMock = vi.hoisted( () => vi.fn() );

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

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigateMock,
} ) );

vi.mock( '@/components/delete-site-dialog', () => ( {
	DeleteSiteDialog: ( { open }: { open: boolean } ) =>
		open ? <div role="dialog">Delete dialog</div> : null,
} ) );

vi.mock( '@/components/site-dropdown', () => ( {
	SiteDropdown: ( props: { site: SiteDetails; showSiteIcon?: boolean; showStatus?: boolean } ) => {
		siteDropdownMock( props );
		return <div>{ props.site.name }</div>;
	},
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-agentic-features', () => ( {
	useAgenticFeatures: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useLogin: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-create-site-helpers', () => ( {
	useExistingCustomDomains: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useCopySite: vi.fn(),
	useExportDatabase: vi.fn(),
	useExportFullSite: vi.fn(),
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
	useSites: vi.fn(),
	useStartSite: vi.fn(),
	useUpdateSite: vi.fn(),
	useXdebugEnabledSite: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-wordpress-versions', () => ( {
	useWordPressVersions: vi.fn(),
	useWpVersion: vi.fn(),
} ) );

vi.mock( '@/hooks/use-sidebar-collapsed', () => ( {
	useSidebarCollapsed: () => false,
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const useAgenticFeaturesMock = vi.mocked( useAgenticFeatures );
const useLoginMock = vi.mocked( useLogin, { partial: true } );
const useExistingCustomDomainsMock = vi.mocked( useExistingCustomDomains, { partial: true } );
const useCopySiteMock = vi.mocked( useCopySite, { partial: true } );
const useExportDatabaseMock = vi.mocked( useExportDatabase, { partial: true } );
const useExportFullSiteMock = vi.mocked( useExportFullSite, { partial: true } );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useSitesMock = vi.mocked( useSites, { partial: true } );
const useStartSiteMock = vi.mocked( useStartSite, { partial: true } );
const useUpdateSiteMock = vi.mocked( useUpdateSite, { partial: true } );
const useWordPressVersionsMock = vi.mocked( useWordPressVersions, { partial: true } );
const useWpVersionMock = vi.mocked( useWpVersion, { partial: true } );
const useXdebugEnabledSiteMock = vi.mocked( useXdebugEnabledSite, { partial: true } );

describe( 'SiteOverviewView', () => {
	const openSiteUrl = vi.fn().mockResolvedValue( undefined );
	const startSite = vi.fn().mockResolvedValue( undefined );
	const copySite = vi.fn();
	const exportFullSite = vi.fn();
	const exportDatabase = vi.fn();
	const onTabChange = vi.fn();

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

		useConnectorMock.mockReturnValue( { openSiteUrl } );
		useAgenticFeaturesMock.mockReturnValue( { enabled: true, reason: null, isReady: true } );
		useLoginMock.mockReturnValue( { isPending: false, mutate: vi.fn() } );
		useExistingCustomDomainsMock.mockReturnValue( [] );
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: true } ) ],
			isLoading: false,
		} );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
		useStartSiteMock.mockReturnValue( {
			isPending: false,
			mutate: startSite,
			mutateAsync: startSite,
		} );
		useCopySiteMock.mockReturnValue( { isPending: false, mutate: copySite } );
		useExportFullSiteMock.mockReturnValue( { isPending: false, mutate: exportFullSite } );
		useExportDatabaseMock.mockReturnValue( { isPending: false, mutate: exportDatabase } );
		useUpdateSiteMock.mockReturnValue( { isPending: false, mutate: vi.fn() } );
		useWordPressVersionsMock.mockReturnValue( { data: undefined } );
		useWpVersionMock.mockReturnValue( { data: undefined } );
		useXdebugEnabledSiteMock.mockReturnValue( null );
	} );

	function renderView( activeTab: 'overview' | 'general' | 'debugging' = 'overview' ) {
		return render(
			<SiteOverviewView siteId="site-1" activeTab={ activeTab } onTabChange={ onTabChange } />
		);
	}

	it( 'renders the tab strip with the customize and manage sections', () => {
		renderView();

		expect( siteDropdownMock ).toHaveBeenCalledWith(
			expect.objectContaining( { showSiteIcon: true, showStatus: false } )
		);
		expect( screen.getByRole( 'tab', { name: 'Overview' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Settings' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Debugging' } ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'Customize' } ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'Manage' } ) ).toBeVisible();
		expect( screen.getByText( 'Site Editor' ) ).toBeVisible();
		expect( screen.getByText( 'Templates' ) ).toBeVisible();
		expect( screen.getByText( 'Media Library' ) ).toBeVisible();
		expect( screen.queryByText( 'Customizer' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Duplicate' ) ).toBeVisible();
		expect( screen.getByText( 'Export' ) ).toBeVisible();
		expect( screen.getByText( 'Export DB' ) ).toBeVisible();
		expect( screen.getByText( 'Delete' ) ).toBeVisible();
		expect( screen.queryByDisplayValue( 'Demo Site' ) ).not.toBeInTheDocument();
	} );

	it( 'reports tab selection to the route', () => {
		renderView();

		fireEvent.click( screen.getByRole( 'tab', { name: 'Settings' } ) );

		expect( onTabChange ).toHaveBeenCalledWith( 'general' );
	} );

	it( 'renders the settings form with save actions on the general tab', () => {
		renderView( 'general' );

		expect( screen.getByDisplayValue( 'Demo Site' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Save settings' } ) ).toBeVisible();
	} );

	it( 'renders the WordPress version dropdown with latest preselected for auto-updating sites', () => {
		useWordPressVersionsMock.mockReturnValue( { data: WP_VERSIONS } );

		renderView( 'general' );

		const select = screen.getByLabelText( 'WordPress version' );
		expect( select.tagName ).toBe( 'SELECT' );
		expect( select ).toHaveValue( '' );
		expect( screen.getByRole( 'option', { name: '6.7.2' } ) ).toBeInTheDocument();
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

		expect( updateSiteMutate ).toHaveBeenCalledWith(
			expect.objectContaining( {
				site: expect.objectContaining( { isWpAutoUpdating: true } ),
				wpVersion: undefined,
			} ),
			expect.anything()
		);
	} );

	it( 'shows classic-theme shortcuts based on theme support', () => {
		useSitesMock.mockReturnValue( {
			data: [
				createSite( {
					running: true,
					themeDetails: {
						name: 'Twenty Twenty-One',
						path: '/wp-content/themes/twentytwentyone',
						slug: 'twentytwentyone',
						isBlockTheme: false,
						supportsMenus: true,
						supportsWidgets: false,
					},
				} ),
			],
			isLoading: false,
		} );

		renderView();

		expect( screen.getByText( 'Customizer' ) ).toBeVisible();
		expect( screen.getByText( 'Menus' ) ).toBeVisible();
		expect( screen.queryByText( 'Widgets' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Site Editor' ) ).not.toBeInTheDocument();
	} );

	// Rendered without a SessionUIProvider, so the open-site-url hook takes
	// its browser fallback path; inside the app these open the preview panel.
	it( 'routes shortcuts through the connector', async () => {
		renderView();

		fireEvent.click( screen.getByText( 'Site Editor' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Media Library' ).closest( 'button' )! );

		await waitFor( () =>
			expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/site-editor.php' )
		);
		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/upload.php' );
	} );

	it( 'runs manage actions and confirms deletion in a dialog', () => {
		renderView();

		fireEvent.click( screen.getByText( 'Duplicate' ).closest( 'button' )! );
		expect( copySite ).toHaveBeenCalledWith( 'site-1' );

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByText( 'Delete' ).closest( 'button' )! );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();
	} );

	it( 'shows a sign-in banner with a login action when signed out', () => {
		const loginMutate = vi.fn();
		useAgenticFeaturesMock.mockReturnValue( {
			enabled: false,
			reason: 'signed-out',
			isReady: true,
		} );
		useLoginMock.mockReturnValue( { isPending: false, mutate: loginMutate } );

		renderView();

		expect(
			screen.getByRole( 'heading', { name: 'Sign in to do more with Studio' } )
		).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Log in with WordPress.com' } ) );

		expect( loginMutate ).toHaveBeenCalled();
	} );

	it( 'hides the sign-in banner while agentic features are available', () => {
		renderView();

		expect(
			screen.queryByRole( 'heading', { name: 'Sign in to do more with Studio' } )
		).not.toBeInTheDocument();
	} );

	it( 'shows a not-found state for unknown sites', () => {
		render(
			<SiteOverviewView siteId="missing-site" activeTab="overview" onTabChange={ onTabChange } />
		);

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
			isBlockTheme: true,
		},
		...overrides,
	};
}
