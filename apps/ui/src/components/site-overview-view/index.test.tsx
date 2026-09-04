import { BackupExtractEvents } from '@studio/common/lib/import-export-events';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import settingsStyles from '@/components/site-settings-view/style.module.css';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useDebugLogExists } from '@/data/queries/use-debug-log';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import { useSiteStorageUsage } from '@/data/queries/use-site-storage-usage';
import { useSiteThumbnail } from '@/data/queries/use-site-thumbnail';
import {
	useCopySite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteBusy,
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
	useUpdateSite,
	useXdebugEnabledSite,
} from '@/data/queries/use-sites';
import { useSnapshots, useSnapshotUsage } from '@/data/queries/use-snapshots';
import { usePullSiteFromLive, usePushSiteToLive } from '@/data/queries/use-sync-site';
import { useWordPressVersions, useWpVersion } from '@/data/queries/use-wordpress-versions';
import { useIsSiteSyncing } from '@/hooks/use-is-site-syncing';
import { useOffline } from '@/hooks/use-offline';
import { useThemeDetails } from '@/hooks/use-theme-details';
import styles from './style.module.css';
import { SiteOverviewView } from './index';
import type { ConnectorCapabilities, SiteDetails, SyncSite } from '@/data/core';
import type { ImportEventTuple } from '@studio/common/lib/import-export-events';

const navigateMock = vi.fn();
const siteToolbarMock = vi.hoisted( () => vi.fn() );
const importSiteFromBackup = vi.hoisted( () => vi.fn() );
const reportSyncProgressMock = vi.hoisted( () => vi.fn() );
const useSidebarCollapsedMock = vi.hoisted( () => vi.fn() );
const useTrafficLightSpaceMock = vi.hoisted( () => vi.fn() );

const WP_VERSIONS = [
	{ label: '6.8', value: 'latest', isBeta: false, isDevelopment: false },
	{ label: '6.8', value: '6.8', isBeta: false, isDevelopment: false },
	{ label: '6.7.2', value: '6.7.2', isBeta: false, isDevelopment: false },
];

const CONNECTED_SITE: SyncSite = {
	id: 42,
	localSiteId: 'site-1',
	name: 'Demo Live',
	url: 'demo.example.com',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
};

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

vi.mock( '@/components/site-toolbar', () => ( {
	SiteToolbar: ( props: { site: SiteDetails; browserPath?: string } ) => {
		siteToolbarMock( props );
		return <div>{ props.site.name }</div>;
	},
} ) );

vi.mock( '@/components/site-dropdown/publish-picker-view', () => ( {
	PublishPickerView: () => <div>Connection picker</div>,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-agentic-features', () => ( {
	useAgenticFeatures: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
	useLogin: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-connected-wpcom-sites', () => ( {
	useConnectedWpcomSites: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-preview-site', () => ( {
	usePublishPreviewSite: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-snapshots', () => ( {
	useSnapshots: vi.fn(),
	useSnapshotUsage: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-create-site-helpers', () => ( {
	useExistingCustomDomains: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	SITES_QUERY_KEY: [ 'sites' ],
	COPY_SITE_MUTATION_KEY: [ 'copySite' ],
	EXPORT_DATABASE_MUTATION_KEY: [ 'exportDatabase' ],
	EXPORT_FULL_SITE_MUTATION_KEY: [ 'exportFullSite' ],
	useCopySite: vi.fn(),
	useExportDatabase: vi.fn(),
	useExportFullSite: vi.fn(),
	useIsSiteBusy: vi.fn(),
	useIsSiteMutating: vi.fn(),
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
	useSites: vi.fn(),
	useStartSite: vi.fn(),
	useUpdateSite: vi.fn(),
	useXdebugEnabledSite: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-debug-log', () => ( {
	debugLogExistsQueryKey: ( siteId: string ) => [ 'debug-log-exists', siteId ],
	useDebugLogExists: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-site-thumbnail', () => ( {
	siteThumbnailQueryKey: ( siteId: string ) => [ 'site-thumbnail', siteId ],
	useSiteThumbnail: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-site-storage-usage', () => ( {
	siteStorageUsageQueryKey: ( siteId: string ) => [ 'site-storage-usage', siteId ],
	useSiteStorageUsage: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sync-site', () => ( {
	usePullSiteFromLive: vi.fn(),
	usePushSiteToLive: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-wordpress-versions', () => ( {
	WP_VERSION_QUERY_KEY: [ 'wp-version' ],
	useWordPressVersions: vi.fn(),
	useWpVersion: vi.fn(),
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: vi.fn(),
} ) );

vi.mock( '@/hooks/use-theme-details', () => ( {
	useThemeDetails: vi.fn(),
} ) );

vi.mock( '@/data/sync-activity', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@/data/sync-activity') >() ),
	reportSyncProgress: reportSyncProgressMock,
} ) );

vi.mock( '@/hooks/use-sidebar-collapsed', () => ( {
	useSidebarCollapsed: useSidebarCollapsedMock,
} ) );

vi.mock( '@/hooks/use-is-site-syncing', () => ( {
	useIsSiteSyncing: vi.fn(),
} ) );

vi.mock( '@/hooks/use-traffic-light-space', () => ( {
	useTrafficLightSpace: useTrafficLightSpaceMock,
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const useAgenticFeaturesMock = vi.mocked( useAgenticFeatures );
const useAuthUserMock = vi.mocked( useAuthUser, { partial: true } );
const useConnectedWpcomSitesMock = vi.mocked( useConnectedWpcomSites, { partial: true } );
const usePublishPreviewSiteMock = vi.mocked( usePublishPreviewSite, { partial: true } );
const useSnapshotsMock = vi.mocked( useSnapshots, { partial: true } );
const useSnapshotUsageMock = vi.mocked( useSnapshotUsage, { partial: true } );
const useLoginMock = vi.mocked( useLogin, { partial: true } );
const useExistingCustomDomainsMock = vi.mocked( useExistingCustomDomains, { partial: true } );
const useCopySiteMock = vi.mocked( useCopySite, { partial: true } );
const useExportDatabaseMock = vi.mocked( useExportDatabase, { partial: true } );
const useExportFullSiteMock = vi.mocked( useExportFullSite, { partial: true } );
const useIsSiteBusyMock = vi.mocked( useIsSiteBusy );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useDebugLogExistsMock = vi.mocked( useDebugLogExists, { partial: true } );
const useSiteThumbnailMock = vi.mocked( useSiteThumbnail, { partial: true } );
const useSiteStorageUsageMock = vi.mocked( useSiteStorageUsage, { partial: true } );
const useSitesMock = vi.mocked( useSites, { partial: true } );
const useStartSiteMock = vi.mocked( useStartSite, { partial: true } );
const useUpdateSiteMock = vi.mocked( useUpdateSite, { partial: true } );
const useOfflineMock = vi.mocked( useOffline );
const useThemeDetailsMock = vi.mocked( useThemeDetails );
const usePullSiteFromLiveMock = vi.mocked( usePullSiteFromLive, { partial: true } );
const usePushSiteToLiveMock = vi.mocked( usePushSiteToLive, { partial: true } );
const useWordPressVersionsMock = vi.mocked( useWordPressVersions, { partial: true } );
const useWpVersionMock = vi.mocked( useWpVersion, { partial: true } );
const useXdebugEnabledSiteMock = vi.mocked( useXdebugEnabledSite, { partial: true } );
const useIsSiteSyncingMock = vi.mocked( useIsSiteSyncing );

describe( 'SiteOverviewView', () => {
	const openSiteUrl = vi.fn().mockResolvedValue( undefined );
	const openSiteDebugLog = vi.fn().mockResolvedValue( undefined );
	const trackEvent = vi.fn().mockResolvedValue( undefined );
	const copyText = vi.fn().mockResolvedValue( undefined );
	const startSite = vi.fn().mockResolvedValue( undefined );
	const copySite = vi.fn();
	const exportFullSite = vi.fn();
	const exportDatabase = vi.fn();
	const openExternalUrl = vi.fn().mockResolvedValue( undefined );
	const pullSiteFromLive = vi.fn();
	const pushSiteToLive = vi.fn();
	const publishPreviewSite = vi.fn();
	const onTabChange = vi.fn();

	const getFilePath = vi.fn().mockResolvedValue( '/tmp/backup.tar.gz' );

	const connectorStub = ( openInOS = true ) => ( {
		openSiteUrl,
		openSiteDebugLog,
		trackEvent,
		copyText,
		getFilePath,
		importSiteFromBackup,
		openExternalUrl,
		capabilities: { openInOS } as ConnectorCapabilities,
	} );

	let queryClient: QueryClient;

	beforeEach( () => {
		vi.clearAllMocks();
		queryClient = new QueryClient( {
			defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
		} );
		importSiteFromBackup.mockResolvedValue( undefined );
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
		useThemeDetailsMock.mockImplementation( ( site ) =>
			site.themeDetails ? { state: 'ready', details: site.themeDetails } : { state: 'unknown' }
		);
		useAgenticFeaturesMock.mockReturnValue( {
			enabled: true,
			chatEnabled: true,
			reason: null,
			isReady: true,
		} );
		useAuthUserMock.mockReturnValue( {
			data: { id: 1, email: 'person@example.com', displayName: 'Person' },
		} );
		useLoginMock.mockReturnValue( { isPending: false, mutate: vi.fn() } );
		useConnectedWpcomSitesMock.mockReturnValue( { data: [], isLoading: false } );
		useSnapshotsMock.mockReturnValue( { data: [] } );
		useSnapshotUsageMock.mockReturnValue( { data: undefined } );
		usePublishPreviewSiteMock.mockReturnValue( {
			isPending: false,
			mutate: publishPreviewSite,
		} );
		usePullSiteFromLiveMock.mockReturnValue( { mutate: pullSiteFromLive } );
		usePushSiteToLiveMock.mockReturnValue( { mutate: pushSiteToLive } );
		useIsSiteSyncingMock.mockReturnValue( { push: false, pull: false } );
		useExistingCustomDomainsMock.mockReturnValue( [] );
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: true } ) ],
			isLoading: false,
		} );
		useIsSiteBusyMock.mockReturnValue( false );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
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
		useDebugLogExistsMock.mockReturnValue( { data: false } );
	} );

	function renderView(
		activeTab: 'overview' | 'general' | 'debugging' = 'overview',
		openSiteDropdown = false,
		siteId = 'site-1'
	) {
		const view = (
			<QueryClientProvider client={ queryClient }>
				<Tooltip.Provider>
					<SiteOverviewView
						siteId={ siteId }
						activeTab={ activeTab }
						openSiteDropdown={ openSiteDropdown }
						onTabChange={ onTabChange }
					/>
				</Tooltip.Provider>
			</QueryClientProvider>
		);
		const rendered = render( view );
		return {
			...rendered,
			showSite: ( nextSiteId: string ) =>
				rendered.rerender(
					<QueryClientProvider client={ queryClient }>
						<Tooltip.Provider>
							<SiteOverviewView
								siteId={ nextSiteId }
								activeTab={ activeTab }
								openSiteDropdown={ openSiteDropdown }
								onTabChange={ onTabChange }
							/>
						</Tooltip.Provider>
					</QueryClientProvider>
				),
		};
	}

	it( 'copies the admin username from the About login line', async () => {
		renderView( 'overview' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Copy admin username' } ) );
		await waitFor( () => expect( copyText ).toHaveBeenCalledWith( 'admin' ) );
	} );

	it( 'reveals and copies the password from the About admin controls', async () => {
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: true, adminPassword: btoa( 'secret-pw' ) } ) ],
			isLoading: false,
		} );
		renderView( 'overview' );

		// Password renders as masked dots until revealed from the overflow menu.
		expect( screen.getByText( '•'.repeat( 8 ) ) ).toBeVisible();
		expect( screen.queryByText( 'secret-pw' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Login options' } ) );
		// Checked by default (password hidden) — unchecking reveals it.
		fireEvent.click( await screen.findByRole( 'menuitemcheckbox', { name: 'Hide password' } ) );

		const revealed = await screen.findByText( 'secret-pw' );
		expect( revealed ).toBeVisible();
		fireEvent.click( revealed );
		await waitFor( () => expect( copyText ).toHaveBeenCalledWith( 'secret-pw' ) );

		// The menu stays open throughout (closeOnClick is false) — checking the
		// box again re-hides the password without reopening the menu.
		fireEvent.click( screen.getByRole( 'menuitemcheckbox', { name: 'Hide password' } ) );
		await waitFor( () => expect( screen.queryByText( 'secret-pw' ) ).not.toBeInTheDocument() );
		expect( screen.getByText( '•'.repeat( 8 ) ) ).toBeVisible();
	} );

	it( 'disables copying the password when the site has none set', () => {
		renderView( 'overview' );

		expect( screen.getByRole( 'button', { name: 'Copy admin password' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
	} );

	it( 'copies the admin email from the Login options menu', async () => {
		renderView( 'overview' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Login options' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Copy email' } ) );

		await waitFor( () => expect( copyText ).toHaveBeenCalledWith( 'admin@example.com' ) );
	} );

	it( 'renders the tab strip with the about, shortcuts, and manage sections', () => {
		renderView();

		expect( siteToolbarMock ).toHaveBeenCalledWith(
			expect.objectContaining( {
				browserPath: '/',
				site: expect.objectContaining( { id: 'site-1' } ),
			} )
		);
		expect( screen.getByRole( 'tab', { name: 'Overview' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Settings' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Debugging' } ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'About' } ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'Shortcuts' } ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'Manage' } ) ).toBeVisible();
		expect( screen.getByText( 'Site Editor' ) ).toBeVisible();
		expect( screen.getByText( 'Templates' ) ).toBeVisible();
		expect( screen.getByText( 'Posts' ) ).toBeVisible();
		expect( screen.getByText( 'Pages' ) ).toBeVisible();
		expect( screen.getByText( 'Media Library' ) ).toBeVisible();
		expect( screen.queryByText( 'Customizer' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Duplicate' ) ).toBeVisible();
		expect( screen.getByText( 'Import' ) ).toBeVisible();
		expect( screen.getByText( 'Export entire site' ) ).toBeVisible();
		expect( screen.getByText( 'Export database' ) ).toBeVisible();
		expect( screen.getByText( 'Delete' ) ).toBeVisible();
		expect( screen.queryByDisplayValue( 'Demo Site' ) ).not.toBeInTheDocument();
	} );

	it( 'summarizes the site theme and runtime versions', async () => {
		useWpVersionMock.mockReturnValue( { data: '6.8.2' } );

		renderView();

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

	it( 'offers a complete empty state for connecting a live site', () => {
		renderView();

		expect( screen.getByRole( 'heading', { name: 'Connections' } ) ).toBeVisible();
		const overviewCard = screen
			.getByRole( 'button', { name: 'Open site in browser' } )
			.closest( 'section' );
		expect( screen.getByRole( 'heading', { name: 'Connections' } ).closest( 'section' ) ).toBe(
			overviewCard
		);
		expect( screen.getByRole( 'heading', { name: 'Preview sites' } ).closest( 'section' ) ).toBe(
			overviewCard
		);
		expect(
			screen.getByText( 'Not connected to a live site yet. Connect one to pull or push changes.' )
		).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Connect a site' } ) ).toBeVisible();
	} );

	it( 'offers login from Connections when signed out', () => {
		const login = vi.fn();
		useAuthUserMock.mockReturnValue( { data: null } );
		useLoginMock.mockReturnValue( { isPending: false, mutate: login } );

		renderView();

		expect(
			screen.getByText( 'Sign in to connect this site to WordPress.com and sync it.' )
		).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Log in with WordPress.com' } ) );
		expect( login ).toHaveBeenCalled();
	} );

	it( 'shows a connected site with direct sync actions and its type', () => {
		useConnectedWpcomSitesMock.mockReturnValue( {
			data: [ CONNECTED_SITE ],
			isLoading: false,
		} );

		renderView();

		expect( screen.getByText( 'demo.example.com' ) ).toBeVisible();
		expect( screen.getByText( 'Never synced' ) ).toBeVisible();
		expect( screen.getByText( 'Production' ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Pull' } ) );
		expect( pullSiteFromLive ).toHaveBeenCalledWith( { siteId: 'site-1', remoteSiteId: 42 } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Push' } ) );
		expect( pushSiteToLive ).toHaveBeenCalledWith( { siteId: 'site-1', remoteSiteId: 42 } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Copy URL' } ) );
		expect( copyText ).toHaveBeenCalledWith( 'https://demo.example.com' );
	} );

	it( 'reflects sync work started from another surface', () => {
		useConnectedWpcomSitesMock.mockReturnValue( {
			data: [ CONNECTED_SITE ],
			isLoading: false,
		} );
		useIsSiteSyncingMock.mockReturnValue( { push: true, pull: false } );

		renderView();

		expect( screen.getByRole( 'button', { name: 'Pushing…' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getByRole( 'button', { name: 'Pull' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
	} );

	it( 'shows preview expiry and account usage', () => {
		useSnapshotsMock.mockReturnValue( {
			data: [
				{
					url: 'demo-preview.wp.build',
					atomicSiteId: 1,
					localSiteId: 'site-1',
					date: Date.now() - 5 * 24 * 60 * 60 * 1000,
				},
			],
		} );
		useSnapshotUsageMock.mockReturnValue( {
			data: { siteCount: 2, siteLimit: 10, siteCreationBlocked: false },
		} );

		renderView();

		const previewUrl = screen.getByText( 'demo-preview.wp.build' );
		expect( previewUrl ).toBeVisible();
		expect( screen.getByText( 'Published 5d ago' ) ).toBeVisible();
		expect( screen.getByText( 'Expires in 2 days' ) ).toBeVisible();
		expect( screen.getByText( '2 of 10' ) ).toBeVisible();
		const previewRow = previewUrl.closest( 'div' )?.parentElement;
		expect( previewRow ).not.toBeNull();
		expect(
			within( previewRow! )
				.getAllByRole( 'button' )
				.map( ( button ) => button.textContent )
		).toEqual( [ 'demo-preview.wp.build', 'Open', 'Update', 'Copy URL' ] );
	} );

	it( 'publishes a preview site from its empty state', () => {
		renderView();

		fireEvent.click( screen.getByRole( 'button', { name: 'Publish a preview site' } ) );

		expect( publishPreviewSite ).toHaveBeenCalledWith( { siteId: 'site-1' } );
	} );

	it( 'explains that preview publishing requires sign-in', () => {
		useAuthUserMock.mockReturnValue( { data: null } );

		renderView();

		expect(
			screen.getByText( 'Sign in to publish a preview site and share your work.' )
		).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'Publish a preview site' } )
		).not.toBeInTheDocument();
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

	it( 'keeps the permanent toolbar when the route requests the old dropdown', () => {
		renderView( 'overview', true );

		expect( siteToolbarMock ).toHaveBeenCalled();
	} );

	it( 'renders the settings form with save actions on the general tab', () => {
		renderView( 'general' );

		expect( screen.getByDisplayValue( 'Demo Site' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Save settings' } ) ).toBeVisible();
	} );

	it( 'copies the admin credentials from the settings form', async () => {
		renderView( 'general' );

		const copyUsername = screen.getByRole( 'button', { name: 'Copy admin username' } );
		expect( copyUsername ).toHaveAttribute( 'data-variant', 'plain' );
		fireEvent.click( copyUsername );
		fireEvent.click( screen.getByRole( 'button', { name: 'Copy admin password' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Copy admin email' } ) );

		await waitFor( () => {
			expect( copyUsername ).toHaveAttribute( 'data-copied', 'true' );
			expect( copyText ).toHaveBeenNthCalledWith( 1, 'admin' );
			expect( copyText ).toHaveBeenNthCalledWith( 2, 'password' );
			expect( copyText ).toHaveBeenNthCalledWith( 3, 'admin@example.com' );
		} );
	} );

	it( 'keeps the admin password visibility toggle', () => {
		renderView( 'general' );

		const password = screen.getByLabelText( 'Admin password' );
		const showPassword = screen.getByRole( 'button', { name: 'Show password' } );
		const copyPassword = screen.getByRole( 'button', { name: 'Copy admin password' } );
		expect( password ).toHaveAttribute( 'type', 'password' );
		expect(
			showPassword.compareDocumentPosition( copyPassword ) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();

		fireEvent.click( showPassword );

		expect( password ).toHaveAttribute( 'type', 'text' );
		expect( screen.getByRole( 'button', { name: 'Hide password' } ) ).toBeVisible();
	} );

	it( 'does not repeat required in the settings field labels', () => {
		renderView( 'general' );

		expect( screen.getByLabelText( 'Site name' ) ).toBeRequired();
		expect( screen.getByLabelText( 'Admin username' ) ).toBeRequired();
		expect( screen.getByLabelText( 'Admin password' ) ).toBeRequired();
		expect( screen.getByLabelText( 'Admin email' ) ).toBeRequired();
		expect( screen.queryByText( /\(Required\)/ ) ).not.toBeInTheDocument();
	} );

	it( 'marks the admin email control for RTL alignment', () => {
		renderView( 'general' );

		expect(
			screen.getByLabelText( 'Admin email' ).closest( '.components-input-control' )
		).toHaveClass( settingsStyles.emailControl );
		expect(
			screen.getByLabelText( 'Admin username' ).closest( '.components-input-control' )
		).not.toHaveClass( settingsStyles.emailControl );
	} );

	it( 'renders the WordPress version dropdown with auto-update preselected for auto-updating sites', () => {
		useWordPressVersionsMock.mockReturnValue( { data: WP_VERSIONS } );
		useWpVersionMock.mockReturnValue( { data: '6.7.2' } );

		renderView( 'general' );

		const select = screen.getByLabelText( 'WordPress version' );
		expect( select.tagName ).toBe( 'SELECT' );
		expect( select ).toHaveValue( '' );
		expect( screen.getByRole( 'option', { name: 'Auto-update (6.7.2)' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'group', { name: 'Stable Versions' } ) ).toBeInTheDocument();
	} );

	it( 'omits the installed version from the auto-update option for pinned sites', () => {
		useWordPressVersionsMock.mockReturnValue( { data: WP_VERSIONS } );
		useWpVersionMock.mockReturnValue( { data: '6.7.2' } );
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: true, isWpAutoUpdating: false } ) ],
		} );

		renderView( 'general' );

		expect( screen.getByRole( 'option', { name: 'Auto-update' } ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'option', { name: 'Auto-update (6.7.2)' } )
		).not.toBeInTheDocument();
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

		const { showSite } = renderView( 'general' );

		fireEvent.change( screen.getByLabelText( 'WordPress version' ), {
			target: { value: '6.7.2' },
		} );

		// A restart event refreshes the site list mid-save.
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: false, isWpAutoUpdating: false } ) ],
			isLoading: false,
		} );
		showSite( 'site-1' );

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
		expect( screen.getByText( 'Posts' ) ).toBeVisible();
		expect( screen.getByText( 'Pages' ) ).toBeVisible();
		expect( screen.getByText( 'Media Library' ) ).toBeVisible();
		expect( screen.queryByText( 'Widgets' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Site Editor' ) ).not.toBeInTheDocument();
	} );

	it( 'gives theme shortcuts stable identities for layout transitions', () => {
		renderView();

		expect( screen.getByText( 'Site Editor' ).closest( 'button' ) ).toHaveStyle( {
			viewTransitionName: 'studio-theme-site-editor',
		} );
		expect( screen.getByText( 'Media Library' ).closest( 'button' ) ).toHaveStyle( {
			viewTransitionName: 'studio-theme-media',
		} );
	} );
	it( 'holds theme-dependent shortcuts while theme details load', () => {
		useThemeDetailsMock.mockReturnValue( { state: 'loading' } );

		const { container } = renderView();

		expect( screen.queryByText( 'Site Editor' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Customizer' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Media Library' ) ).not.toBeInTheDocument();
		expect( container.querySelectorAll( `.${ styles.buttonSkeleton }` ) ).toHaveLength( 7 );
	} );

	it( 'shows theme-independent shortcuts when theme details are unavailable', () => {
		useThemeDetailsMock.mockReturnValue( { state: 'unknown' } );

		renderView();

		expect( screen.getByText( 'Posts' ) ).toBeVisible();
		expect( screen.getByText( 'Pages' ) ).toBeVisible();
		expect( screen.getByText( 'Media Library' ) ).toBeVisible();
		expect( screen.queryByText( 'Customizer' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Site Editor' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByText( 'Posts' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Pages' ).closest( 'button' )! );
		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/edit.php' );
		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/edit.php?post_type=page' );
	} );

	// Rendered without a SessionUIProvider, so the open-site-url hook takes
	// its browser fallback path; inside the app these open the preview panel.
	it( 'routes shortcuts through the connector', async () => {
		renderView();

		fireEvent.click( screen.getByText( 'Site Editor' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Posts' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Pages' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Media Library' ).closest( 'button' )! );

		await waitFor( () =>
			expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/site-editor.php' )
		);
		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/edit.php' );
		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/edit.php?post_type=page' );
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

	function selectBackup( name: string ) {
		const input = screen.getByTestId( 'import-backup-file' );
		Object.defineProperty( input, 'files', {
			configurable: true,
			value: [ new File( [ 'backup' ], name ) ],
		} );
		fireEvent.change( input );
	}

	it( 'imports a backup after confirming the overwrite', async () => {
		renderView();

		selectBackup( 'demo-site.tar.gz' );

		const dialog = screen.getByRole( 'alertdialog' );
		expect( dialog ).toHaveTextContent( 'Overwrite Demo Site?' );
		expect( dialog ).toHaveTextContent( 'demo-site.tar.gz' );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Import' } ) );

		await waitFor( () =>
			expect( importSiteFromBackup ).toHaveBeenCalledWith(
				'site-1',
				'/tmp/backup.tar.gz',
				expect.any( Function )
			)
		);
	} );

	// An import replaces the site wholesale, so everything read off it is stale.
	// Disk usage caches for five minutes and the overview never unmounts, so
	// without an explicit invalidation it keeps showing pre-import numbers.
	it( 'refetches the site details an import invalidates', async () => {
		const staleKeys = [
			[ 'sites' ],
			[ 'wp-version', 'site-1' ],
			[ 'site-storage-usage', 'site-1' ],
			[ 'site-thumbnail', 'site-1' ],
		];
		renderView();
		staleKeys.forEach( ( key ) => queryClient.setQueryData( key, 'before-import' ) );

		selectBackup( 'demo-site.tar.gz' );
		fireEvent.click(
			within( screen.getByRole( 'alertdialog' ) ).getByRole( 'button', { name: 'Import' } )
		);

		await waitFor( () =>
			staleKeys.forEach( ( key ) =>
				expect( queryClient.getQueryState( key )?.isInvalidated ).toBe( true )
			)
		);
	} );

	it( 'rejects an unsupported backup file without opening the overwrite dialog', () => {
		renderView();

		selectBackup( 'notes.txt' );

		expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument();
		expect( importSiteFromBackup ).not.toHaveBeenCalled();
	} );

	// The buttons mark themselves with `aria-disabled` rather than the native
	// attribute, so they stay focusable.
	function isManageButtonDisabled( label: string ) {
		const heading = screen.getByRole( 'heading', { name: 'Manage' } );
		const button = within( heading.closest( 'section' )! ).getByText( label ).closest( 'button' )!;
		return button.getAttribute( 'aria-disabled' ) === 'true';
	}

	// The overview stays mounted across sites — only the `$siteId` route param
	// changes — so import progress must be tracked per site, not per component.
	it( 'keeps the import indicator on the importing site when switching sites', async () => {
		useSitesMock.mockReturnValue( {
			data: [
				createSite( { running: true } ),
				createSite( { id: 'site-2', name: 'Other Site', running: true } ),
			],
			isLoading: false,
		} );
		let finishImport = () => {};
		importSiteFromBackup.mockReturnValue(
			new Promise< void >( ( resolve ) => {
				finishImport = resolve;
			} )
		);
		const { showSite } = renderView();

		selectBackup( 'demo-site.tar.gz' );
		fireEvent.click(
			within( screen.getByRole( 'alertdialog' ) ).getByRole( 'button', { name: 'Import' } )
		);
		await waitFor( () => expect( isManageButtonDisabled( 'Export entire site' ) ).toBe( true ) );

		showSite( 'site-2' );

		expect( isManageButtonDisabled( 'Import' ) ).toBe( false );
		expect( isManageButtonDisabled( 'Export entire site' ) ).toBe( false );

		showSite( 'site-1' );

		expect( isManageButtonDisabled( 'Export entire site' ) ).toBe( true );

		// Settle it so the shared activity store doesn't stay pending for site-1
		// and bleed into the tests that follow.
		finishImport();
		await waitFor( () => expect( isManageButtonDisabled( 'Export entire site' ) ).toBe( false ) );
	} );

	// Extraction emits one progress event per stream chunk, so a large backup
	// would otherwise notify every activity subscriber thousands of times a
	// second and the app stops responding to clicks.
	it( 'only reports progress when the status text changes', async () => {
		let emitProgress: ( ( event: ImportEventTuple ) => void ) | undefined;
		importSiteFromBackup.mockImplementation( async ( _siteId, _path, onProgress ) => {
			emitProgress = onProgress;
		} );
		renderView();

		selectBackup( 'demo-site.tar.gz' );
		fireEvent.click(
			within( screen.getByRole( 'alertdialog' ) ).getByRole( 'button', { name: 'Import' } )
		);
		await waitFor( () => expect( emitProgress ).toBeDefined() );

		for ( let processedFiles = 1; processedFiles <= 500; processedFiles++ ) {
			emitProgress?.( [
				BackupExtractEvents.BACKUP_EXTRACT_PROGRESS,
				{ processedFiles: processedFiles <= 250 ? 1 : 2, totalFiles: 10 },
			] as ImportEventTuple );
		}

		expect( reportSyncProgressMock.mock.calls ).toEqual( [
			[ 'site-1', 'import', { message: '10% · Extracting…' } ],
			[ 'site-1', 'import', { message: '20% · Extracting…' } ],
		] );
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

	// Driven by a lookup rather than the setting: the log may not exist yet.
	describe( 'debug log shortcut', () => {
		it( 'offers to open the log once one exists', () => {
			useDebugLogExistsMock.mockReturnValue( { data: true } );
			renderView( 'debugging' );

			expect( screen.getByRole( 'button', { name: 'Open log file' } ) ).toBeVisible();
		} );

		it( 'stays hidden while the site has no log yet', () => {
			useDebugLogExistsMock.mockReturnValue( { data: false } );
			renderView( 'debugging' );

			expect( screen.queryByRole( 'button', { name: 'Open log file' } ) ).not.toBeInTheDocument();
		} );

		it( 'asks the host to open the log', () => {
			useDebugLogExistsMock.mockReturnValue( { data: true } );
			renderView( 'debugging' );

			fireEvent.click( screen.getByRole( 'button', { name: 'Open log file' } ) );

			expect( openSiteDebugLog ).toHaveBeenCalledWith( 'site-1' );
		} );

		// Turning logging off stops WordPress writing, but leaves the file behind.
		it( 'still offers the log after logging is turned off', () => {
			useSitesMock.mockReturnValue( {
				data: [ createSite( { running: true, enableDebugLog: false } ) ],
			} );
			useDebugLogExistsMock.mockReturnValue( { data: true } );
			renderView( 'debugging' );

			expect( screen.getByRole( 'button', { name: 'Open log file' } ) ).toBeVisible();
		} );

		// The custom control replaces DataForm's rendering of the description.
		it( 'keeps the field description', () => {
			useDebugLogExistsMock.mockReturnValue( { data: true } );
			renderView( 'debugging' );

			expect(
				screen.getByText(
					"Log PHP errors and warnings to a debug.log file in your site's wp-content directory."
				)
			).toBeVisible();
		} );
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
