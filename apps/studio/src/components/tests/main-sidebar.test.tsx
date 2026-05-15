import { render, act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import MainSidebar from 'src/components/main-sidebar';
import { useAuth } from 'src/hooks/use-auth';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { store } from 'src/stores';
import { useGetWpComSitesQuery } from 'src/stores/sync/wpcom-sites';
import type { SyncSite } from '@studio/common/types/sync';

const { mockFeatureFlags } = vi.hoisted( () => ( {
	mockFeatureFlags: {
		enableBlueprints: true,
		enableStudioCodeUi: false,
		enableWorkspaces: false,
	},
} ) );

vi.mock( 'src/hooks/use-auth' );
vi.mock( 'src/hooks/use-feature-flags', () => ( {
	useFeatureFlags: () => mockFeatureFlags,
} ) );

vi.mock( 'src/stores/wordpress-versions-api', () => ( {
	wordpressVersionsApi: {
		reducer: () => ( {} ),
		middleware: () => () => () => {},
	},
	useGetWordPressVersions: vi.fn( () => ( {
		data: [
			{ label: 'Latest', value: '6.7.2' },
			{ label: '6.8-beta1', value: '6.8-beta1', isBeta: true, isDevelopment: false },
			{ label: '6.4', value: '6.4', isBeta: false, isDevelopment: false },
			{ label: '6.3', value: '6.3', isBeta: false, isDevelopment: false },
			{ label: '6.2', value: '6.2', isBeta: false, isDevelopment: false },
		],
		isLoading: false,
	} ) ),
} ) );

vi.mock( 'src/stores/wpcom-api', async () => {
	const actual = ( await vi.importActual( 'src/stores/wpcom-api' ) ) || {};
	return {
		...actual,
		useGetBlueprints: vi.fn().mockReturnValue( {
			data: {
				blueprints: [],
				total: 0,
			},
			isLoading: false,
			refetch: vi.fn(),
			isUninitialized: false,
		} ),
	};
} );

vi.mock( 'src/stores/sync/wpcom-sites', () => ( {
	wpcomSitesApi: {
		reducerPath: 'wpcomSitesApi',
		reducer: () => ( {} ),
		middleware: () => ( next: ( action: unknown ) => unknown ) => ( action: unknown ) =>
			next( action ),
	},
	useGetWpComSitesQuery: vi.fn( () => ( {
		data: { sites: [] },
		isFetching: false,
	} ) ),
} ) );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	__esModule: true,
	default: vi.fn(),
	getIpcApi: () => ( {
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		showOpenFolderDialog: vi.fn(),
		generateProposedSitePath: vi.fn(),
		openURL: vi.fn(),
		getAllCustomDomains: vi.fn().mockResolvedValue( [] ),
		getUserEditor: vi.fn().mockResolvedValue( 'cursor' ),
		getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
		setWindowControlVisibility: vi.fn(),
		setupAppMenu: vi.fn(),
	} ),
} ) );

const site2 = {
	name: 'test-2',
	path: '/fake/test-2',
	running: false,
	id: 'da1dad4b-37d5-41d2-a77b-26d5e0649ec3',
	port: 8882,
};
const siteDetailsMocked = {
	selectedSite: site2,
	sites: [
		{
			name: 'test-1',
			path: '/fake/test-1',
			running: false,
			id: '0e9e237b-335a-43fa-b439-9b078a618512',
			port: 8881,
		},
		site2,
		{
			name: 'test-3',
			path: '/fake/test-3',
			running: true,
			id: '0e9e237b-335a-43fa-b439-9b078a613333',
			port: 8883,
		},
	],
	loadingServer: {
		[ site2.id ]: false,
	},
	snapshots: [],
	setSelectedSiteId: vi.fn(),
	createSite: vi.fn(),
	startServer: vi.fn(),
	stopServer: vi.fn(),
	isSiteDeleting: vi.fn( () => false ),
	selectedWpcomSite: undefined as SyncSite | undefined,
	setSelectedWpcomSite: vi.fn(),
	wpcomSiteActivity: {},
	setWpcomSiteActivity: vi.fn(),
};
vi.mock( 'src/hooks/use-site-details', () => ( {
	useSiteDetails: () => ( { ...siteDetailsMocked } ),
} ) );

const renderWithProvider = ( children: React.ReactElement ) => {
	return render(
		<Provider store={ store }>
			<ContentTabsProvider>{ children }</ContentTabsProvider>
		</Provider>
	);
};

beforeEach( () => {
	vi.clearAllMocks();
	site2.running = false;
	siteDetailsMocked.selectedWpcomSite = undefined;
	siteDetailsMocked.wpcomSiteActivity = {};
	mockFeatureFlags.enableWorkspaces = false;
	vi.mocked( useAuth, { partial: true } ).mockReturnValue( { isAuthenticated: false } );
	vi.mocked( useGetWpComSitesQuery, { partial: true } ).mockReturnValue( {
		data: { sites: [] },
		isFetching: false,
	} );
} );

describe( 'MainSidebar Footer', () => {
	it( 'Has add site button', async () => {
		await act( async () => renderWithProvider( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'Add site' } ) ).toBeVisible();
	} );

	it( 'applies className prop', async () => {
		const { container } = await act( async () =>
			renderWithProvider( <MainSidebar className={ 'test-class' } /> )
		);
		expect( container.firstChild ).toHaveClass( 'test-class' );
	} );

	it( 'shows a "Stop" button when there is a running site', async () => {
		await act( async () => renderWithProvider( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'Stop' } ) ).toBeVisible();
	} );

	it( 'shows a "Stop All" button when there are multiple running sites', async () => {
		site2.running = true;
		await act( async () => renderWithProvider( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'Stop all' } ) ).toBeVisible();
		site2.running = false;
	} );
} );

describe( 'MainSidebar Site Menu', () => {
	it( 'renders the list of sites', async () => {
		await act( async () => renderWithProvider( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'test-1' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'test-2' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'test-3' } ) ).toBeVisible();
	} );

	it( 'has "start site" buttons when sites are not running', async () => {
		await act( async () => renderWithProvider( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'start test-1 site' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'start test-2 site' } ) ).toBeVisible();
	} );

	it( 'starts a site', async () => {
		const user = userEvent.setup();
		await act( async () => renderWithProvider( <MainSidebar /> ) );
		const greenDotFirstSite = screen.getByRole( 'button', { name: 'start test-1 site' } );
		expect( greenDotFirstSite ).toBeVisible();
		await user.click( greenDotFirstSite );
		expect( siteDetailsMocked.startServer ).toHaveBeenCalledWith(
			expect.objectContaining( { id: '0e9e237b-335a-43fa-b439-9b078a618512', name: 'test-1' } )
		);
	} );

	it( 'stops a site', async () => {
		const user = userEvent.setup();
		await act( async () => renderWithProvider( <MainSidebar /> ) );
		const greenDotFirstSite = screen.getByRole( 'button', { name: 'stop test-3 site' } );
		expect( greenDotFirstSite ).toBeVisible();
		await user.click( greenDotFirstSite );
		expect( siteDetailsMocked.stopServer ).toHaveBeenCalledWith(
			'0e9e237b-335a-43fa-b439-9b078a613333'
		);
	} );

	it( 'renders WordPress.com sites as flat live-site rows', async () => {
		mockFeatureFlags.enableWorkspaces = true;
		const user = userEvent.setup();
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
			isAuthenticated: true,
			user: {
				id: 1,
				email: 'dsmart@example.com',
				displayName: 'D Smart',
			},
		} );
		vi.mocked( useGetWpComSitesQuery, { partial: true } ).mockReturnValue( {
			data: {
				sites: [
					{
						id: 101,
						name: 'Auro Atelier',
						url: 'https://auro.example',
					},
				],
			},
			isFetching: false,
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );

		const wpcomSectionButton = screen.getByRole( 'button', { name: 'WordPress.com' } );
		expect( wpcomSectionButton ).toBeVisible();
		expect( wpcomSectionButton ).toHaveAttribute( 'aria-expanded', 'true' );
		const wpcomSiteButton = screen.getByRole( 'button', { name: 'Auro Atelier' } );
		expect( wpcomSiteButton ).toBeVisible();
		expect( wpcomSiteButton ).toHaveClass( 'p-2' );
		expect( wpcomSiteButton ).not.toHaveClass( 'pl-6' );
		expect( screen.getByRole( 'img', { name: 'Live WordPress.com site' } ) ).toBeVisible();

		await user.click( wpcomSectionButton );
		expect( wpcomSectionButton ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( screen.queryByRole( 'button', { name: 'Auro Atelier' } ) ).not.toBeInTheDocument();

		await user.click( wpcomSectionButton );
		await user.click( screen.getByRole( 'button', { name: 'Auro Atelier' } ) );
		expect( siteDetailsMocked.setSelectedWpcomSite ).toHaveBeenCalledWith(
			expect.objectContaining( { id: 101, name: 'Auro Atelier' } )
		);
	} );

	it( 'hides WordPress.com site rows when Workspaces is disabled', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
			isAuthenticated: true,
			user: {
				id: 1,
				email: 'dsmart@example.com',
				displayName: 'D Smart',
			},
		} );
		vi.mocked( useGetWpComSitesQuery, { partial: true } ).mockReturnValue( {
			data: {
				sites: [
					{
						id: 101,
						name: 'Auro Atelier',
						url: 'https://auro.example',
					},
				],
			},
			isFetching: false,
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );

		expect( screen.queryByRole( 'button', { name: 'WordPress.com' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Auro Atelier' } ) ).not.toBeInTheDocument();
	} );

	it( 'groups WordPress.com production and staging sites into one workspace row', async () => {
		mockFeatureFlags.enableWorkspaces = true;
		siteDetailsMocked.selectedWpcomSite = {
			id: 101,
			localSiteId: '',
			name: 'Auro Atelier',
			url: 'https://auro.example',
			isStaging: false,
			isPressable: false,
			syncSupport: 'syncable',
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		};
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
			isAuthenticated: true,
			user: {
				id: 1,
				email: 'dsmart@example.com',
				displayName: 'D Smart',
			},
		} );
		vi.mocked( useGetWpComSitesQuery, { partial: true } ).mockReturnValue( {
			data: {
				sites: [
					{
						id: 101,
						name: 'Auro Atelier',
						url: 'https://auro.example',
						isStaging: false,
						stagingSiteIds: [ 202 ],
					},
					{
						id: 202,
						name: 'Auro Atelier Staging',
						url: 'https://staging-auro.example',
						isStaging: true,
						productionSiteId: 101,
					},
				],
			},
			isFetching: false,
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );

		expect( screen.getByRole( 'button', { name: 'Auro Atelier' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'Auro Atelier Staging' } )
		).not.toBeInTheDocument();
		expect( screen.getByRole( 'img', { name: 'Production and staging sites' } ) ).toBeVisible();

		await userEvent.click( screen.getByRole( 'button', { name: 'Auro Atelier' } ) );
		expect( siteDetailsMocked.setSelectedWpcomSite ).toHaveBeenCalledWith(
			expect.objectContaining( { id: 101, name: 'Auro Atelier' } )
		);
	} );

	it( 'collapses grouped WordPress.com targets until the workspace is selected', async () => {
		mockFeatureFlags.enableWorkspaces = true;
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
			isAuthenticated: true,
			user: {
				id: 1,
				email: 'dsmart@example.com',
				displayName: 'D Smart',
			},
		} );
		vi.mocked( useGetWpComSitesQuery, { partial: true } ).mockReturnValue( {
			data: {
				sites: [
					{
						id: 101,
						name: 'Mariachi Market',
						url: 'https://mariachi.example',
						isStaging: false,
						stagingSiteIds: [ 202 ],
					},
					{
						id: 202,
						name: 'Mariachi Market Staging',
						url: 'https://staging-mariachi.wpcomstaging.com',
						isStaging: true,
						productionSiteId: 101,
					},
				],
			},
			isFetching: false,
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );

		expect( screen.getByRole( 'button', { name: 'Mariachi Market' } ) ).toBeVisible();
		expect( screen.getByRole( 'img', { name: 'Production and staging sites' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'Select Production site: https://mariachi.example' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', {
				name: 'Select Staging site: https://staging-mariachi.wpcomstaging.com',
			} )
		).not.toBeInTheDocument();
	} );

	it( 'shows a progress indicator for a WordPress.com site while Dolly is thinking', async () => {
		mockFeatureFlags.enableWorkspaces = true;
		siteDetailsMocked.wpcomSiteActivity = {
			101: { isAssistantThinking: true },
		};
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
			isAuthenticated: true,
			user: {
				id: 1,
				email: 'dsmart@example.com',
				displayName: 'D Smart',
			},
		} );
		vi.mocked( useGetWpComSitesQuery, { partial: true } ).mockReturnValue( {
			data: {
				sites: [
					{
						id: 101,
						name: 'Auro Atelier',
						url: 'https://auro.example',
					},
				],
			},
			isFetching: false,
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );

		expect( screen.getByRole( 'status', { name: 'Dolly is thinking' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'img', { name: 'Live WordPress.com site' } )
		).not.toBeInTheDocument();
	} );

	it( 'shows an unread indicator for a WordPress.com site with a hidden Dolly reply', async () => {
		mockFeatureFlags.enableWorkspaces = true;
		siteDetailsMocked.wpcomSiteActivity = {
			101: { hasUnreadAssistantMessage: true },
		};
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
			isAuthenticated: true,
			user: {
				id: 1,
				email: 'dsmart@example.com',
				displayName: 'D Smart',
			},
		} );
		vi.mocked( useGetWpComSitesQuery, { partial: true } ).mockReturnValue( {
			data: {
				sites: [
					{
						id: 101,
						name: 'Auro Atelier',
						url: 'https://auro.example',
					},
				],
			},
			isFetching: false,
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );

		expect( screen.getByRole( 'status', { name: 'Unread Dolly response' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'img', { name: 'Live WordPress.com site' } )
		).not.toBeInTheDocument();
	} );

	it( 'shows a progress indicator on the workspace while staging is being created', async () => {
		mockFeatureFlags.enableWorkspaces = true;
		siteDetailsMocked.selectedWpcomSite = {
			id: 101,
			localSiteId: '',
			name: 'Auro Atelier',
			url: 'https://auro.example',
			isStaging: false,
			isPressable: false,
			syncSupport: 'syncable',
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		};
		siteDetailsMocked.wpcomSiteActivity = {
			101: { isCreatingStagingSite: true },
		};
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
			isAuthenticated: true,
			user: {
				id: 1,
				email: 'dsmart@example.com',
				displayName: 'D Smart',
			},
		} );
		vi.mocked( useGetWpComSitesQuery, { partial: true } ).mockReturnValue( {
			data: {
				sites: [
					{
						id: 101,
						name: 'Auro Atelier',
						url: 'https://auro.example',
						isStaging: false,
						stagingSiteIds: [ 202 ],
					},
					{
						id: 202,
						name: 'Auro Atelier Staging',
						url: 'https://staging-auro.example',
						isStaging: true,
						productionSiteId: 101,
					},
				],
			},
			isFetching: false,
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );

		expect( screen.getByRole( 'status', { name: 'Creating staging site' } ) ).toBeVisible();
	} );

	it( 'groups same-name WordPress.com staging sites when relationship metadata is missing', async () => {
		mockFeatureFlags.enableWorkspaces = true;
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
			isAuthenticated: true,
			user: {
				id: 1,
				email: 'dsmart@example.com',
				displayName: 'D Smart',
			},
		} );
		vi.mocked( useGetWpComSitesQuery, { partial: true } ).mockReturnValue( {
			data: {
				sites: [
					{
						id: 101,
						name: 'My Store',
						url: 'https://store.example',
						isStaging: false,
					},
					{
						id: 202,
						name: 'My Store',
						url: 'https://staging-store.wpcomstaging.com',
						isStaging: true,
					},
				],
			},
			isFetching: false,
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );

		expect( screen.getAllByRole( 'button', { name: 'My Store' } ) ).toHaveLength( 1 );
		expect( screen.getByRole( 'img', { name: 'Production and staging sites' } ) ).toBeVisible();
	} );

	it( 'does not group same-name WordPress.com sites unless one is marked staging', async () => {
		mockFeatureFlags.enableWorkspaces = true;
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
			isAuthenticated: true,
			user: {
				id: 1,
				email: 'dsmart@example.com',
				displayName: 'D Smart',
			},
		} );
		vi.mocked( useGetWpComSitesQuery, { partial: true } ).mockReturnValue( {
			data: {
				sites: [
					{
						id: 101,
						name: 'My Store',
						url: 'https://store.example',
						isStaging: false,
					},
					{
						id: 202,
						name: 'My Store',
						url: 'https://another-store.wpcomstaging.com',
						isStaging: false,
					},
				],
			},
			isFetching: false,
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );

		expect( screen.getAllByRole( 'button', { name: 'My Store' } ) ).toHaveLength( 2 );
		expect(
			screen.queryByRole( 'img', { name: 'Production and staging sites' } )
		).not.toBeInTheDocument();
	} );
} );
