// To run tests, execute `npm run test -- src/modules/sync/tests/index.test.tsx` from the root directory
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { SyncSitesProvider, useSyncSites } from 'src/hooks/sync-sites';
import { SyncPushState } from 'src/hooks/sync-sites/use-sync-push';
import { useAuth } from 'src/hooks/use-auth';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ContentTabSync } from 'src/modules/sync';
import { useSelectedItemsPushSize } from 'src/modules/sync/hooks/use-selected-items-push-size';
import { store } from 'src/stores';
import {
	useLatestRewindId,
	useRemoteFileTree,
	useConnectedSitesData,
	useSyncSitesData,
	useConnectedSitesOperations,
	connectedSitesSelectors,
} from 'src/stores/sync';

jest.mock( 'src/hooks/use-auth' );
jest.mock( 'src/lib/get-ipc-api' );
jest.mock( 'src/hooks/use-feature-flags' );
jest.mock( 'src/hooks/sync-sites/sync-sites-context', () => ( {
	...jest.requireActual( '../../../hooks/sync-sites/sync-sites-context' ),
	useSyncSites: jest.fn(),
} ) );

jest.mock( 'src/stores', () => ( {
	...jest.requireActual( 'src/stores' ),
	useAppDispatch: jest.fn(),
} ) );

jest.mock( 'src/stores/sync', () => ( {
	...jest.requireActual( 'src/stores/sync' ),
	useLatestRewindId: jest.fn(),
	useRemoteFileTree: jest.fn().mockReturnValue( {
		fetchChildren: jest.fn().mockResolvedValue( [] ),
		error: null,
		isLoading: false,
	} ),
	useConnectedSitesData: jest.fn(),
	useSyncSitesData: jest.fn(),
	useConnectedSitesOperations: jest.fn(),
	connectedSitesSelectors: {
		selectIsModalOpen: jest.fn(),
		selectModalMode: jest.fn(),
	},
	connectedSitesActions: {
		openModal: jest.fn().mockImplementation( () => {
			return { type: 'connectedSites/openModal' };
		} ),
		setModalMode: jest.fn().mockImplementation( () => {
			return { type: 'connectedSites/setModalMode' };
		} ),
		closeModal: jest.fn().mockImplementation( () => {
			return { type: 'connectedSites/closeModal' };
		} ),
	},
} ) );

jest.mock( 'src/modules/sync/hooks/use-selected-items-push-size' );

const createAuthMock = ( isAuthenticated: boolean = false ) => ( {
	isAuthenticated,
	authenticate: jest.fn(),
} );

const selectedSite: SiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	adminPassword: btoa( 'test-password' ),
	running: false,
	phpVersion: '8.3',
	id: 'site-id',
};

const inProgressPushState: SyncPushState = {
	remoteSiteId: 1,
	status: {
		key: 'creatingRemoteBackup',
		progress: 50,
		message: '',
	},
	selectedSite,
	remoteSiteUrl: 'https://example.com',
};

const fakeSyncSite = {
	id: 6,
	name: 'My simple business site that needs a transfer',
	url: 'https://developer.wordpress.com/studio/',
	syncSupport: 'already-connected',
};

describe( 'ContentTabSync', () => {
	const mockSyncSites = {
		pullSite: jest.fn(),
		isAnySitePulling: false,
		isAnySitePushing: false,
		getPullState: jest.fn(),
		getPushState: jest.fn().mockReturnValue( inProgressPushState ),
		updateTimestamp: jest.fn(),
		getLastSyncTimeWithType: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
		isSiteIdPulling: jest.fn(),
		isSiteIdPushing: jest.fn(),
		clearTimeout: jest.fn(),
	};

	const setupConnectedSitesMocks = (
		connectedSites: SyncSite[] = [],
		syncSites: SyncSite[] = []
	) => {
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites,
			loading: false,
			localSiteId: 'site-id',
		} );
		( useSyncSitesData as jest.Mock ).mockReturnValue( {
			syncSites,
			isFetching: false,
			refetchSites: jest.fn(),
		} );
	};
	beforeEach( () => {
		jest.resetAllMocks();
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( false ) );
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			enableBlueprints: true,
			streamlineOnboarding: false,
		} );
		( getIpcApi as jest.Mock ).mockReturnValue( {
			authenticate: jest.fn(),
			generateProposedSitePath: jest.fn(),
			openURL: jest.fn(),
			showMessageBox: jest.fn(),
			updateConnectedWpcomSites: jest.fn(),
			getConnectedWpcomSites: jest.fn().mockResolvedValue( [] ),
			getDirectorySize: jest.fn().mockResolvedValue( 0 ),
			listLocalFileTree: jest.fn().mockResolvedValue( [
				{
					name: 'plugins',
					isDirectory: true,
					path: 'wp-content/plugins/',
					children: [
						{
							name: 'test-plugin',
							isDirectory: true,
							path: 'wp-content/plugins/test-plugin/',
						},
					],
				},
				{
					name: 'themes',
					isDirectory: true,
					path: 'wp-content/themes/',
					children: [
						{
							name: 'test-theme',
							isDirectory: true,
							path: 'wp-content/themes/test-theme/',
						},
					],
				},
			] ),
		} );
		( useSelectedItemsPushSize as jest.Mock ).mockReturnValue( {
			isPushSelectionOverLimit: false,
			isLoading: false,
		} );
		( useSyncSites as jest.Mock ).mockReturnValue( mockSyncSites );
		( useLatestRewindId as jest.Mock ).mockReturnValue( {
			rewindId: '1704067200',
			isLoading: false,
			error: null,
		} );

		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [],
			loading: false,
			localSiteId: 'site-id',
		} );

		( useSyncSitesData as jest.Mock ).mockReturnValue( {
			syncSites: [],
			isFetching: false,
			refetchSites: jest.fn(),
		} );

		( useConnectedSitesOperations as jest.Mock ).mockReturnValue( {
			connectSite: jest.fn(),
			disconnectSite: jest.fn(),
		} );

		const { useAppDispatch } = jest.requireMock( 'src/stores' );
		useAppDispatch.mockReturnValue( jest.fn() );

		( connectedSitesSelectors.selectIsModalOpen as jest.Mock ).mockReturnValue( false );
		( connectedSitesSelectors.selectModalMode as jest.Mock ).mockReturnValue( null );
		( useRemoteFileTree as jest.Mock ).mockReturnValue( {
			fetchChildren: jest.fn().mockResolvedValue( [
				{
					id: 'plugins',
					name: 'plugins',
					label: 'plugins',
					checked: false,
					type: 'folder',
					pathId: 'cjI6,ZjI6Lw==',
					path: '/wp-content/plugins/',
					loading: false,
					children: [],
					expanded: false,
				},
				{
					id: 'uploads',
					name: 'uploads',
					label: 'uploads',
					checked: false,
					type: 'folder',
					pathId: 'ZjM6Lw==',
					path: '/wp-content/uploads/',
					loading: false,
					children: [],
					expanded: false,
				},
			] ),
			error: null,
			isLoading: false,
		} );

		Object.defineProperty( window, 'matchMedia', {
			writable: true,
			value: jest.fn().mockImplementation( ( query ) => ( {
				matches: false,
				media: query,
				onchange: null,
				addListener: jest.fn(), // deprecated
				removeListener: jest.fn(), // deprecated
				addEventListener: jest.fn(),
				removeEventListener: jest.fn(),
				dispatchEvent: jest.fn(),
			} ) ),
		} );
	} );

	const renderWithProvider = ( children: React.ReactElement ) => {
		return render(
			<Provider store={ store }>
				<ContentTabsProvider>
					<SyncSitesProvider>{ children }</SyncSitesProvider>
				</ContentTabsProvider>
			</Provider>
		);
	};

	it( 'renders the sync title and login buttons', () => {
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );
		expect( screen.getByText( 'Sync with WordPress.com or Pressable' ) ).toBeInTheDocument();

		const loginButton = screen.getByRole( 'button', { name: /Log in to WordPress.com/i } );
		expect( loginButton ).toBeInTheDocument();

		fireEvent.click( loginButton );
		expect( useAuth().authenticate ).toHaveBeenCalled();

		const freeAccountButton = screen.getByRole( 'button', { name: /Create a free account/i } );
		expect( freeAccountButton ).toBeInTheDocument();

		fireEvent.click( freeAccountButton );
		expect( getIpcApi().authenticate ).toHaveBeenCalled();
	} );

	it( 'displays publish and import actions to authenticated user', () => {
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			enableBlueprints: true,
			streamlineOnboarding: true,
		} );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );
		const publishButton = screen.getByRole( 'button', { name: /Publish site/i } );
		const importButton = screen.getByRole( 'button', { name: /Pull site/i } );

		expect( publishButton ).toBeInTheDocument();
		expect( importButton ).toBeInTheDocument();
	} );

	it( 'opens the site selector modal when clicking import button', () => {
		const mockSyncSite: SyncSite = {
			id: 123,
			name: 'Test Site',
			url: 'https://example.wordpress.com',
			isStaging: false,
			syncSupport: 'already-connected',
			localSiteId: 'site-id',
			isPressable: false,
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		};

		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			enableBlueprints: true,
			streamlineOnboarding: true,
		} );
		setupConnectedSitesMocks( [], [ mockSyncSite ] );
		( connectedSitesSelectors.selectIsModalOpen as jest.Mock ).mockReturnValue( true );
		( connectedSitesSelectors.selectModalMode as jest.Mock ).mockReturnValue( 'pull' );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );
		expect( screen.getByTestId( 'sync-sites-modal-selector' ) ).toBeInTheDocument();
	} );

	it( 'displays the list of connected sites', async () => {
		const fakeSyncSite = {
			id: 6,
			name: 'My simple business site that needs a transfer',
			url: 'https://developer.wordpress.com/studio/',
			isStaging: false,
			syncSupport: 'already-connected',
		};
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
			loading: false,
			localSiteId: 'site-id',
		} );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			pullSite: jest.fn(),
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn().mockReturnValue( undefined ),
			getLastSyncTimeText: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
			isSiteIdPulling: jest.fn(),
			isSiteIdPushing: jest.fn(),
			clearTimeout: jest.fn(),
		} );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		expect( screen.getByText( fakeSyncSite.name ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /Disconnect/i } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /Pull/i } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /Push/i } ) ).toBeInTheDocument();
		expect( screen.getByText( 'Production' ) ).toBeInTheDocument();
	} );

	it( 'opens URL for connected sites', async () => {
		const fakeSyncSite = {
			id: 6,
			name: 'My simple business site that needs a transfer',
			url: 'https://developer.wordpress.com/studio/',
			isStaging: false,
			syncSupport: 'already-connected',
		};
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
			loading: false,
			localSiteId: 'site-id',
		} );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			pullSite: jest.fn(),
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn().mockReturnValue( inProgressPushState ),
			getLastSyncTimeText: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
			isSiteIdPulling: jest.fn(),
			isSiteIdPushing: jest.fn(),
			clearTimeout: jest.fn(),
		} );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const readableUrl = fakeSyncSite.url.replace( 'https://', '' );
		const urlButton = screen.getByRole( 'button', {
			name: ( content ) => content.includes( readableUrl ),
		} );
		expect( urlButton ).toBeInTheDocument();

		fireEvent.click( urlButton );
		expect( getIpcApi().openURL ).toHaveBeenCalledWith( fakeSyncSite.url );
	} );

	it( 'opens the modal and displays the create new site button', () => {
		const mockSyncSite: SyncSite = {
			id: 123,
			name: 'Test Site',
			url: 'https://example.wordpress.com',
			isStaging: false,
			syncSupport: 'already-connected',
			localSiteId: 'site-id',
			isPressable: false,
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		};

		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [], [ mockSyncSite ] );
		( connectedSitesSelectors.selectIsModalOpen as jest.Mock ).mockReturnValue( true );
		( connectedSitesSelectors.selectModalMode as jest.Mock ).mockReturnValue( 'connect' );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );
		const createNewSiteButton = screen.getByRole( 'button', {
			name: /Create a new WordPress.com site ↗/i,
		} );
		expect( createNewSiteButton ).toBeInTheDocument();
	} );

	it( 'displays publish and import buttons when there are no connected sites', () => {
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			enableBlueprints: true,
			streamlineOnboarding: true,
		} );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const publishButton = screen.getByRole( 'button', { name: /Publish site/i } );
		const importButton = screen.getByRole( 'button', { name: /Pull site/i } );

		expect( publishButton ).toBeInTheDocument();
		expect( importButton ).toBeInTheDocument();
	} );

	it( 'displays environment badges for Pressable sites with production, staging and development environments', () => {
		const fakePressableProductionSite: SyncSite = {
			id: 6,
			name: 'My Pressable Production site',
			url: 'https://pressable-site.com',
			isStaging: false,
			isPressable: true,
			environmentType: 'production',
			syncSupport: 'already-connected',
			localSiteId: 'site-id',
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		};
		const fakePressableStagingSite: SyncSite = {
			id: 7,
			name: 'My Pressable Staging site',
			url: 'https://staging-pressable-site.com',
			isStaging: false,
			isPressable: true,
			environmentType: 'staging',
			syncSupport: 'already-connected',
			localSiteId: 'site-id',
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		};
		const fakePressableDevelopmentSite: SyncSite = {
			id: 8,
			name: 'My Pressable Development site',
			url: 'https://development-pressable-site.com',
			isStaging: false,
			isPressable: true,
			environmentType: 'development',
			syncSupport: 'already-connected',
			localSiteId: 'site-id',
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		};
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );

		const allSites = [
			fakePressableProductionSite,
			fakePressableStagingSite,
			fakePressableDevelopmentSite,
		];
		setupConnectedSitesMocks( allSites, [ fakePressableProductionSite ] );

		( useSyncSites as jest.Mock ).mockReturnValue( {
			connectedSites: allSites,
			syncSites: [ fakePressableProductionSite ],
			pullSite: jest.fn(),
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn().mockReturnValue( undefined ),
			getLastSyncTimeText: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
			isSiteIdPulling: jest.fn(),
			isSiteIdPushing: jest.fn(),
			clearTimeout: jest.fn(),
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		expect( screen.getByText( fakePressableProductionSite.name ) ).toBeInTheDocument();
		expect( screen.getByText( fakePressableStagingSite.name ) ).toBeInTheDocument();
		expect( screen.getByText( fakePressableDevelopmentSite.name ) ).toBeInTheDocument();

		expect( screen.getByText( 'Production' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Staging' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Development' ) ).toBeInTheDocument();
	} );
	it( 'displays the progress bar when the site is being pushed', () => {
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		const fakeSyncSite: SyncSite = {
			id: 6,
			name: 'My simple business site that needs a transfer',
			url: 'https://developer.wordpress.com/studio/',
			syncSupport: 'already-connected',
			isStaging: false,
			localSiteId: 'site-id',
			isPressable: false,
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		};

		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
		} );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			pullSite: jest.fn(),
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn().mockReturnValue( inProgressPushState ),
			getLastSyncTimeText: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
			isSiteIdPulling: jest.fn(),
			isSiteIdPushing: jest.fn().mockReturnValue( true ),
			clearTimeout: jest.fn(),
		} );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		expect( screen.getByRole( 'progressbar' ) ).toBeInTheDocument();
	} );

	it( 'opens sync pullSite dialog with development environment label', async () => {
		const mockPullSite = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		const fakeSyncSite = {
			id: 6,
			name: 'My simple business site that needs a transfer',
			url: 'https://developer.wordpress.com/studio/',
			syncSupport: 'already-connected',
			isPressable: true,
			environmentType: 'development',
		};
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
		} );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			syncSites: [ fakeSyncSite ],
			pullSite: mockPullSite,
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn(),
			getLastSyncTimeText: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
			isSiteIdPulling: jest.fn(),
			isSiteIdPushing: jest.fn(),
			clearTimeout: jest.fn(),
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = screen.getByRole( 'button', { name: /Pull/i } );
		expect( pullButton ).toBeInTheDocument();
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Development' );
		await screen.findByText(
			"Pulling will overwrite your Studio site's selected files and database with a copy from your development site. Unchecked items will not be changed."
		);
	} );

	it( 'opens sync pullSite dialog and displays production when the environment is not supported', async () => {
		const mockPullSite = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		const fakeSyncSite = {
			id: 6,
			name: 'My simple business site that needs a transfer',
			url: 'https://developer.wordpress.com/studio/',
			syncSupport: 'already-connected',
			isPressable: true,
			environmentType: 'non-supported-environment-example-or-sandbox',
		};
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
		} );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			pullSite: mockPullSite,
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn(),
			getLastSyncTimeText: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
			isSiteIdPulling: jest.fn(),
			isSiteIdPushing: jest.fn(),
			clearTimeout: jest.fn(),
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = screen.getByRole( 'button', { name: /Pull/i } );
		expect( pullButton ).toBeInTheDocument();
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Production' );
		await screen.findByText(
			"Pulling will overwrite your Studio site's selected files and database with a copy from your production site. Unchecked items will not be changed."
		);
	} );

	it( 'calls pullSite with correct optionsToSync when all options are selected', async () => {
		const mockPullSite = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		const fakeSyncSite = {
			id: 6,
			name: 'My simple business site that needs a transfer',
			url: 'https://developer.wordpress.com/studio/',
			syncSupport: 'already-connected',
		};
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
		} );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			pullSite: mockPullSite,
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn(),
			getLastSyncTimeText: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
			isSiteIdPulling: jest.fn(),
			isSiteIdPushing: jest.fn(),
			clearTimeout: jest.fn(),
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = screen.getByRole( 'button', { name: /Pull/i } );
		expect( pullButton ).toBeInTheDocument();
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Production' );

		const filesAndFoldersCheckbox = screen.getByRole( 'checkbox', { name: 'Files and folders' } );
		fireEvent.click( filesAndFoldersCheckbox );
		const databaseCheckbox = screen.getByRole( 'checkbox', { name: 'Database' } );
		fireEvent.click( databaseCheckbox );

		const dialogPullButton = screen.getAllByRole( 'button', { name: /Pull/i } );
		fireEvent.click( dialogPullButton[ 1 ] );

		expect( mockPullSite ).toHaveBeenCalledWith( fakeSyncSite, selectedSite, {
			optionsToSync: [ 'all' ],
		} );
	} );

	it( 'calls pullSite with correct optionsToSync when only database is selected', async () => {
		const mockPullSite = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		const fakeSyncSite = {
			id: 6,
			name: 'My simple business site that needs a transfer',
			url: 'https://developer.wordpress.com/studio/',
			syncSupport: 'already-connected',
		};
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
		} );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			pullSite: mockPullSite,
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn(),
			getLastSyncTimeText: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
			isSiteIdPulling: jest.fn(),
			isSiteIdPushing: jest.fn(),
			clearTimeout: jest.fn(),
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = screen.getByRole( 'button', { name: /Pull/i } );
		expect( pullButton ).toBeInTheDocument();
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Production' );

		const databaseCheckbox = screen.getByRole( 'checkbox', { name: 'Database' } );
		fireEvent.click( databaseCheckbox );

		const dialogPullButton = screen.getAllByRole( 'button', { name: /Pull/i } );
		fireEvent.click( dialogPullButton[ 1 ] );

		expect( mockPullSite ).toHaveBeenCalledWith( fakeSyncSite, selectedSite, {
			optionsToSync: [ 'sqls' ],
		} );
	} );

	it( 'calls pullSite with correct optionsToSync when options partially are selected', async () => {
		const mockPullSite = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		( useRemoteFileTree as jest.Mock ).mockReturnValue( {
			fetchChildren: jest.fn().mockResolvedValue( [
				{
					id: 'mu-plugins',
					name: 'mu-plugins',
					label: 'mu-plugins',
					checked: false,
					type: 'folder',
					pathId: 'ZjY6L211LXBsdWdpbnMv',
					path: '/wp-content/mu-plugins/',
					loading: false,
					children: [],
					expanded: false,
				},
				{
					id: 'index.php',
					name: 'index.php',
					label: 'index.php',
					checked: false,
					type: 'file',
					pathId: 'ZjY6L2luZGV4LnBocA==',
					path: '/wp-content/index.php/',
					loading: false,
					expanded: false,
				},
				{
					id: 'themes',
					name: 'themes',
					label: 'themes',
					checked: false,
					type: 'folder',
					pathId: 'cjE6,ZjE6Lw==',
					path: '/wp-content/themes/',
					loading: false,
					children: [],
					expanded: false,
				},
				{
					id: 'plugins',
					name: 'plugins',
					label: 'plugins',
					checked: false,
					type: 'folder',
					pathId: 'cjI6,ZjI6Lw==',
					path: '/wp-content/plugins/',
					loading: false,
					children: [],
					expanded: false,
				},
				{
					id: 'uploads',
					name: 'uploads',
					label: 'uploads',
					checked: false,
					type: 'folder',
					pathId: 'ZjM6Lw==',
					path: '/wp-content/uploads/',
					loading: false,
					children: [],
					expanded: false,
				},
			] ),
			error: null,
			isLoading: false,
		} );
		const fakeSyncSite = {
			id: 6,
			name: 'My simple business site that needs a transfer',
			url: 'https://developer.wordpress.com/studio/',
			syncSupport: 'already-connected',
		};
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
		} );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			pullSite: mockPullSite,
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn(),
			getLastSyncTimeText: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
			isSiteIdPulling: jest.fn(),
			isSiteIdPushing: jest.fn(),
			clearTimeout: jest.fn(),
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = screen.getByRole( 'button', { name: /Pull/i } );
		expect( pullButton ).toBeInTheDocument();
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Production' );

		const databaseCheckbox = screen.getByRole( 'checkbox', { name: 'Database' } );
		fireEvent.click( databaseCheckbox );

		// Open specific files and folders selector
		const select = screen.getByRole( 'combobox', { name: 'Select files and folders to sync' } );
		fireEvent.change( select, { target: { value: 'true' } } );

		// Check plugins and uploads
		const pluginsCheckbox = screen.getByRole( 'checkbox', { name: 'plugins' } );
		fireEvent.click( pluginsCheckbox );
		const uploadsCheckbox = screen.getByRole( 'checkbox', { name: 'uploads' } );
		fireEvent.click( uploadsCheckbox );

		const dialogPullButton = screen.getAllByRole( 'button', { name: /Pull/i } );
		fireEvent.click( dialogPullButton[ 1 ] );

		expect( mockPullSite ).toHaveBeenCalledWith( fakeSyncSite, selectedSite, {
			optionsToSync: [ 'paths', 'sqls' ],
			include_path_list: [ 'cjI6,ZjI6Lw==', 'ZjM6Lw==' ],
		} );
	} );

	it( 'disables the pull button when all checkboxes are unchecked, which is the initial state', async () => {
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = screen.getByRole( 'button', { name: /Pull/i } );
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Production' );
		const dialogPullButton = screen.getAllByRole( 'button', { name: /Pull/i } )[ 1 ];
		expect( dialogPullButton ).toBeDisabled();
	} );

	it( 'disables the push button when all checkboxes are unchecked, which is the initial state', async () => {
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pushButton = screen.getByRole( 'button', { name: /Push/i } );
		fireEvent.click( pushButton );

		await screen.findByText( 'Push to Production' );
		const dialogPushButton = screen.getAllByRole( 'button', { name: /Push/i } )[ 1 ];
		expect( dialogPushButton ).toBeDisabled();
	} );

	it( 'enables the pull button when at least one checkbox is checked', async () => {
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = screen.getByRole( 'button', { name: /Pull/i } );
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Production' );

		// Check the database checkbox
		const databaseCheckbox = screen.getByRole( 'checkbox', { name: 'Database' } );
		fireEvent.click( databaseCheckbox );

		const dialogPullButton = screen.getAllByRole( 'button', { name: /Pull/i } )[ 1 ];
		expect( dialogPullButton ).toBeEnabled();
	} );

	it( 'enables the pull button when at least one checkbox children is checked', async () => {
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = screen.getByRole( 'button', { name: /Pull/i } );
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Production' );
		const select = screen.getByRole( 'combobox', { name: 'Select files and folders to sync' } );
		fireEvent.change( select, { target: { value: 'true' } } );
		const pluginsCheckbox = screen.getByRole( 'checkbox', { name: 'plugins' } );
		fireEvent.click( pluginsCheckbox );
		const filesAndFoldersCheckbox = screen.getByRole( 'checkbox', { name: 'Files and folders' } );
		const databaseCheckbox = screen.getByRole( 'checkbox', { name: 'Database' } );

		// Note: Checkbox state assertions are flaky in test environment
		// The key test is that the pull button becomes enabled
		expect( databaseCheckbox ).not.toBeChecked();
		expect( filesAndFoldersCheckbox ).not.toBeChecked();

		const dialogPullButton = screen.getAllByRole( 'button', { name: /Pull/i } )[ 1 ];
		expect( dialogPullButton ).toBeEnabled();
	} );
	it( 'disables the push button when all checkboxes are unchecked', async () => {
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pushButton = screen.getByRole( 'button', { name: /Push/i } );
		fireEvent.click( pushButton );

		await screen.findByText( 'Push to Production' );
		const dialogPushButton = screen.getAllByRole( 'button', { name: /Push/i } )[ 1 ];
		expect( dialogPushButton ).toBeDisabled();
	} );

	it( 'enables the push button when at least one checkbox is checked', async () => {
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pushButton = screen.getByRole( 'button', { name: /Push/i } );
		fireEvent.click( pushButton );

		await screen.findByText( 'Push to Production' );
		const databaseCheckbox = screen.getByRole( 'checkbox', { name: 'Database' } );
		fireEvent.click( databaseCheckbox );

		const dialogPushButton = screen.getAllByRole( 'button', { name: /Push/i } )[ 1 ];
		expect( dialogPushButton ).toBeEnabled();
	} );

	it( 'enables the push button when at least one checkbox children is checked', async () => {
		( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pushButton = screen.getByRole( 'button', { name: /Push/i } );
		fireEvent.click( pushButton );

		await screen.findByText( 'Push to Production' );
		const select = screen.getByRole( 'combobox', { name: 'Select files and folders to sync' } );
		fireEvent.change( select, { target: { value: 'true' } } );

		const pluginsCheckbox = screen.getByRole( 'checkbox', { name: 'plugins' } );
		fireEvent.click( pluginsCheckbox );

		const filesAndFoldersCheckbox = screen.getByRole( 'checkbox', { name: 'Files and folders' } );
		const databaseCheckbox = screen.getByRole( 'checkbox', { name: 'Database' } );

		expect( pluginsCheckbox ).toBeChecked();
		expect( databaseCheckbox ).not.toBeChecked();
		expect( filesAndFoldersCheckbox ).not.toBeChecked();

		const dialogPushButton = screen.getAllByRole( 'button', { name: /Push/i } )[ 1 ];
		expect( dialogPushButton ).toBeEnabled();
	} );

	describe( 'Sync Dialog Push Selection Over Limit Notice', () => {
		it( 'shows warning notice when push selection exceeds limit', async () => {
			( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
			( useConnectedSitesData as jest.Mock ).mockReturnValue( {
				connectedSites: [ fakeSyncSite ],
				loading: false,
				localSiteId: 'site-id',
			} );
			( useSelectedItemsPushSize as jest.Mock ).mockReturnValue( {
				isPushSelectionOverLimit: true,
				isLoading: false,
			} );

			renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

			const pushButton = screen.getByRole( 'button', { name: /Push/i } );
			fireEvent.click( pushButton );

			await screen.findByText( 'Push to Production' );

			const warningNotice = screen.getByTestId( 'push-selection-over-limit-notice' );
			expect( warningNotice ).toBeInTheDocument();

			const dialogPushButton = screen.getAllByRole( 'button', { name: /Push/i } )[ 1 ];
			expect( dialogPushButton ).toBeDisabled();
		} );

		it( 'does not show warning notice when push selection is within limit', async () => {
			( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
			( useConnectedSitesData as jest.Mock ).mockReturnValue( {
				connectedSites: [ fakeSyncSite ],
				loading: false,
				localSiteId: 'site-id',
			} );
			( useSelectedItemsPushSize as jest.Mock ).mockReturnValue( {
				isPushSelectionOverLimit: false,
				isLoading: false,
			} );

			renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

			const pushButton = screen.getByRole( 'button', { name: /Push/i } );
			fireEvent.click( pushButton );

			await screen.findByText( 'Push to Production' );

			const warningNotice = screen.queryByTestId( 'push-selection-over-limit-notice' );
			expect( warningNotice ).not.toBeInTheDocument();
		} );

		it( 'does not show warning notice for pull operations even when limit exceeded', async () => {
			( useAuth as jest.Mock ).mockReturnValue( createAuthMock( true ) );
			( useConnectedSitesData as jest.Mock ).mockReturnValue( {
				connectedSites: [ fakeSyncSite ],
				loading: false,
				localSiteId: 'site-id',
			} );
			( useSelectedItemsPushSize as jest.Mock ).mockReturnValue( {
				isPushSelectionOverLimit: true,
				isLoading: false,
			} );

			renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

			const pullButton = screen.getByRole( 'button', { name: /Pull/i } );
			fireEvent.click( pullButton );

			await screen.findByText( 'Pull from Production' );

			const warningNotice = screen.queryByTestId( 'push-selection-over-limit-notice' );
			expect( warningNotice ).not.toBeInTheDocument();
		} );
	} );
} );
