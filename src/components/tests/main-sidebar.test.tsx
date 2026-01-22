import { render, act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import MainSidebar from 'src/components/main-sidebar';
import { SyncSitesProvider } from 'src/hooks/sync-sites';
import { useAuth } from 'src/hooks/use-auth';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { store } from 'src/stores';

vi.mock( 'src/hooks/use-auth' );

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
};
vi.mock( 'src/hooks/use-site-details', () => ( {
	useSiteDetails: () => ( { ...siteDetailsMocked } ),
} ) );

const renderWithProvider = ( children: React.ReactElement ) => {
	return render(
		<Provider store={ store }>
			<ContentTabsProvider>
				<SyncSitesProvider>{ children }</SyncSitesProvider>
			</ContentTabsProvider>
		</Provider>
	);
};

describe( 'MainSidebar Footer', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );
	it( 'Has add site button', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( { isAuthenticated: false } );
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
			'0e9e237b-335a-43fa-b439-9b078a618512'
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
} );
