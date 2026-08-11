import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useLogin } from '@/data/queries/use-auth-user';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useSiteStorageUsage } from '@/data/queries/use-site-storage-usage';
import { useSiteThumbnail } from '@/data/queries/use-site-thumbnail';
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
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useWordPressVersions, useWpVersion } from '@/data/queries/use-wordpress-versions';
import { useOffline } from '@/hooks/use-offline';
import styles from './style.module.css';
import { SiteOverviewView } from './index';
import type {
	ConnectorCapabilities,
	SiteDetails,
	SupportedEditor,
	UserPreferences,
} from '@/data/core';

const navigateMock = vi.fn();
const siteDropdownMock = vi.hoisted( () => vi.fn() );
const useSidebarCollapsedMock = vi.hoisted( () => vi.fn() );
const useTrafficLightSpaceMock = vi.hoisted( () => vi.fn() );

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
	SiteDropdown: ( props: {
		site: SiteDetails;
		showSiteIcon?: boolean;
		showStatus?: boolean;
		defaultOpen?: boolean;
	} ) => {
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

vi.mock( '@/data/queries/use-site-thumbnail', () => ( {
	useSiteThumbnail: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-site-storage-usage', () => ( {
	useSiteStorageUsage: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-wordpress-versions', () => ( {
	useWordPressVersions: vi.fn(),
	useWpVersion: vi.fn(),
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: vi.fn(),
} ) );

vi.mock( '@/hooks/use-sidebar-collapsed', () => ( {
	useSidebarCollapsed: useSidebarCollapsedMock,
} ) );

vi.mock( '@/hooks/use-traffic-light-space', () => ( {
	useTrafficLightSpace: useTrafficLightSpaceMock,
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
const useSiteThumbnailMock = vi.mocked( useSiteThumbnail, { partial: true } );
const useSiteStorageUsageMock = vi.mocked( useSiteStorageUsage, { partial: true } );
const useSitesMock = vi.mocked( useSites, { partial: true } );
const useStartSiteMock = vi.mocked( useStartSite, { partial: true } );
const useUpdateSiteMock = vi.mocked( useUpdateSite, { partial: true } );
const useOfflineMock = vi.mocked( useOffline );
const useUserPreferencesMock = vi.mocked( useUserPreferences, { partial: true } );
const useWordPressVersionsMock = vi.mocked( useWordPressVersions, { partial: true } );
const useWpVersionMock = vi.mocked( useWpVersion, { partial: true } );
const useXdebugEnabledSiteMock = vi.mocked( useXdebugEnabledSite, { partial: true } );

describe( 'SiteOverviewView', () => {
	const openSiteUrl = vi.fn().mockResolvedValue( undefined );
	const openSiteFolder = vi.fn().mockResolvedValue( undefined );
	const openSiteInEditor = vi.fn().mockResolvedValue( undefined );
	const openSiteInTerminal = vi.fn().mockResolvedValue( undefined );
	const trackEvent = vi.fn().mockResolvedValue( undefined );
	const startSite = vi.fn().mockResolvedValue( undefined );
	const copySite = vi.fn();
	const exportFullSite = vi.fn();
	const exportDatabase = vi.fn();
	const onTabChange = vi.fn();

	const connectorStub = ( openInOS = true ) => ( {
		openSiteUrl,
		openSiteFolder,
		openSiteInEditor,
		openSiteInTerminal,
		trackEvent,
		capabilities: { openInOS } as ConnectorCapabilities,
	} );

	const preferencesStub = ( editor: SupportedEditor | null ) =>
		( { editor, terminal: 'terminal' } ) as UserPreferences;

	beforeEach( () => {
		vi.clearAllMocks();
		useSidebarCollapsedMock.mockReturnValue( false );
		useTrafficLightSpaceMock.mockReturnValue( { start: false, end: false } );
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

		useConnectorMock.mockReturnValue( connectorStub() );
		useUserPreferencesMock.mockReturnValue( { data: preferencesStub( 'vscode' ) } );
		useAgenticFeaturesMock.mockReturnValue( {
			enabled: true,
			chatEnabled: true,
			reason: null,
			isReady: true,
		} );
		useLoginMock.mockReturnValue( { isPending: false, mutate: vi.fn() } );
		useExistingCustomDomainsMock.mockReturnValue( [] );
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: true } ) ],
			isLoading: false,
		} );
		useSiteThumbnailMock.mockReturnValue( {
			data: 'data:image/png;base64,site-thumbnail',
		} );
		useSiteStorageUsageMock.mockReturnValue( {
			data: {
				total: 800,
				uploads: 400,
				plugins: 200,
				themes: 100,
				database: 50,
				other: 50,
			},
			isPending: false,
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
		useOfflineMock.mockReturnValue( false );
		useWordPressVersionsMock.mockReturnValue( { data: undefined } );
		useWpVersionMock.mockReturnValue( { data: undefined } );
		useXdebugEnabledSiteMock.mockReturnValue( null );
	} );

	function renderView(
		activeTab: 'overview' | 'general' | 'debugging' = 'overview',
		openSiteDropdown = false
	) {
		return render(
			<Tooltip.Provider>
				<SiteOverviewView
					siteId="site-1"
					activeTab={ activeTab }
					openSiteDropdown={ openSiteDropdown }
					onTabChange={ onTabChange }
				/>
			</Tooltip.Provider>
		);
	}

	it( 'renders the tab strip with the about, customize, and manage sections', () => {
		renderView();

		expect( siteDropdownMock ).toHaveBeenCalledWith(
			expect.objectContaining( { showSiteIcon: true, showStatus: false } )
		);
		expect( screen.getByRole( 'tab', { name: 'Overview' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Settings' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Debugging' } ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'About' } ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'Customize' } ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'Manage' } ) ).toBeVisible();
		expect( screen.getByText( 'Site Editor' ) ).toBeVisible();
		expect( screen.getByText( 'Templates' ) ).toBeVisible();
		expect( screen.getByText( 'Media Library' ) ).toBeVisible();
		expect( screen.queryByText( 'Customizer' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Duplicate' ) ).toBeVisible();
		expect( screen.getByText( 'Export entire site' ) ).toBeVisible();
		expect( screen.getByText( 'Export database' ) ).toBeVisible();
		expect( screen.getByText( 'Delete' ) ).toBeVisible();
		expect( screen.queryByDisplayValue( 'Demo Site' ) ).not.toBeInTheDocument();
	} );

	it( 'summarizes the site theme and runtime versions', async () => {
		useWpVersionMock.mockReturnValue( { data: '6.8.2' } );

		renderView();

		expect( screen.getByText( 'Theme' ) ).toBeVisible();
		expect( screen.getByText( 'Twenty Twenty-Six' ) ).toBeVisible();
		expect( screen.getByText( 'WP v6.8.2' ) ).toBeVisible();
		expect( screen.getByText( 'PHP v8.4' ) ).toBeVisible();
		expect( await screen.findByRole( 'img', { name: 'Screenshot of Demo Site' } ) ).toHaveAttribute(
			'src',
			'data:image/png;base64,site-thumbnail'
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Open site in browser' } ) );
		await waitFor( () =>
			expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/', { autoLogin: false } )
		);
	} );

	it( 'shows the total disk usage and an accessible category breakdown', () => {
		renderView();

		expect( screen.getByText( 'Disk' ) ).toBeVisible();
		expect( screen.getByText( '800 B' ) ).toBeVisible();
		expect(
			screen.getByRole( 'group', {
				name: 'Disk usage breakdown: Media — 400 B (50%), Plugins — 200 B (25%), Themes — 100 B (13%), Database — 50 B (6%), Other — 50 B (6%)',
			} )
		).toBeVisible();
		expect( screen.getByText( 'Media' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Plugins' ) ).toBeInTheDocument();
	} );

	it( 'indicates when disk usage is still being measured', () => {
		useSiteStorageUsageMock.mockReturnValue( { data: undefined, isPending: true } );

		renderView();

		expect( screen.getByText( 'Measuring…' ) ).toBeVisible();
	} );

	it( 'keeps the browser action available without a cached thumbnail', () => {
		useSiteThumbnailMock.mockReturnValue( { data: null } );

		renderView();

		expect( screen.getByRole( 'button', { name: 'Open site in browser' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'img', { name: 'Screenshot of Demo Site' } )
		).not.toBeInTheDocument();
	} );

	it( 'offsets the site menu below macOS traffic lights when the sidebar is collapsed', () => {
		useSidebarCollapsedMock.mockReturnValue( true );
		useTrafficLightSpaceMock.mockReturnValue( { start: true, end: false } );

		renderView();

		expect( screen.getByText( 'Demo Site' ).parentElement ).toHaveClass(
			styles.headerSidebarCollapsed
		);
	} );

	it( 'reports tab selection to the route', () => {
		renderView();

		fireEvent.click( screen.getByRole( 'tab', { name: 'Settings' } ) );

		expect( onTabChange ).toHaveBeenCalledWith( 'general' );
	} );

	it( 'opens site status when requested by the route', () => {
		renderView( 'overview', true );

		expect( siteDropdownMock ).toHaveBeenCalledWith(
			expect.objectContaining( { defaultOpen: true } )
		);
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
				<SiteOverviewView siteId="site-1" activeTab="general" onTabChange={ onTabChange } />
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

	it( 'offers the configured apps and phpMyAdmin under Open in…', () => {
		renderView();

		expect( screen.getByRole( 'heading', { name: 'Open in…' } ) ).toBeVisible();
		expect( screen.getByText( 'Finder' ) ).toBeVisible();
		expect( screen.getByText( 'Visual Studio Code' ) ).toBeVisible();
		expect( screen.getByText( 'Terminal' ) ).toBeVisible();
		expect( screen.queryByText( 'Browser' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByText( 'Finder' ).closest( 'button' )! );
		expect( openSiteFolder ).toHaveBeenCalledWith( 'site-1' );

		fireEvent.click( screen.getByText( 'phpMyAdmin' ).closest( 'button' )! );
		expect( openSiteUrl ).toHaveBeenCalledWith(
			'site-1',
			'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
		);
		expect( trackEvent ).toHaveBeenCalledWith( 'studio_site_open_phpmyadmin', {
			browser: 'internal',
		} );
	} );

	it( 'hides the editor shortcut until an editor is configured', () => {
		useUserPreferencesMock.mockReturnValue( { data: preferencesStub( null ) } );

		renderView();

		expect( screen.queryByText( 'Visual Studio Code' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Finder' ) ).toBeVisible();
	} );

	it( 'drops the Open in… section on hosts that cannot open local apps', () => {
		useConnectorMock.mockReturnValue( connectorStub( false ) );

		renderView();

		expect( screen.queryByRole( 'heading', { name: 'Open in…' } ) ).not.toBeInTheDocument();
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

	it( 'records a customize Tracks event with the entry_point for each shortcut', () => {
		renderView();

		fireEvent.click( screen.getByText( 'Site Editor' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Media Library' ).closest( 'button' )! );

		expect( trackEvent ).toHaveBeenCalledWith( 'studio_site_open_customize', {
			entry_point: 'editor',
			browser: 'internal',
		} );
		expect( trackEvent ).toHaveBeenCalledWith( 'studio_site_open_customize', {
			entry_point: 'media_library',
			browser: 'internal',
		} );
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
			chatEnabled: false,
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
