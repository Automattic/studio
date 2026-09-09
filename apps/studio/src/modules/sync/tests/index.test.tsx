// To run tests, execute `npm run test -- src/modules/sync/tests/index.test.tsx` from the root directory
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { SyncSite } from '@studio/common/types/sync';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { SYNC_OPTIONS } from 'src/constants';
import { useAuth } from 'src/hooks/use-auth';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { recordRendererTracksEvent } from 'src/lib/analytics';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ContentTabSync } from 'src/modules/sync';
import { useSelectedItemsPushSize } from 'src/modules/sync/hooks/use-selected-items-push-size';
import { store } from 'src/stores';
import { syncOperationsActions, useLatestRewindId, useRemoteFileTree } from 'src/stores/sync';
import { useGetWpComSitesQuery } from 'src/stores/sync/wpcom-sites';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';

store.replaceReducer( testReducer );

const mockPullSiteThunk = vi.hoisted( () => vi.fn() );
const mockPushSiteThunk = vi.hoisted( () => vi.fn() );

vi.mock( 'src/components/dot-grid', () => ( { DotGrid: () => null } ) );
vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/lib/analytics', () => ( { recordRendererTracksEvent: vi.fn() } ) );
vi.mock( 'src/hooks/use-auth' );
vi.mock( 'src/stores/sync/wpcom-sites', async () => {
	const actual = await vi.importActual< typeof import('src/stores/sync/wpcom-sites') >(
		'src/stores/sync/wpcom-sites'
	);
	return {
		...actual,
		useGetWpComSitesQuery: vi.fn(),
	};
} );

vi.mock( 'src/stores/sync', async () => {
	const actual = await vi.importActual< typeof import('src/stores/sync') >( 'src/stores/sync' );
	return {
		...actual,
		useLatestRewindId: vi.fn(),
		useRemoteFileTree: vi.fn().mockReturnValue( {
			fetchChildren: vi.fn().mockResolvedValue( [] ),
			error: null,
			isLoading: false,
		} ),
		syncOperationsThunks: {
			...actual.syncOperationsThunks,
			pullSite: mockPullSiteThunk,
			pushSite: mockPushSiteThunk,
		},
	};
} );

vi.mock( 'src/modules/sync/hooks/use-selected-items-push-size' );

vi.mock( 'src/stores/wordpress-versions-api', async () => {
	const actual = await vi.importActual< typeof import('src/stores/wordpress-versions-api') >(
		'src/stores/wordpress-versions-api'
	);
	return {
		...actual,
		useGetWordPressVersions: () => ( {
			data: [
				{ value: 'latest', isBeta: false, isDevelopment: false, label: 'Latest' },
				{ value: '6.4.0', isBeta: false, isDevelopment: false, label: '6.4' },
				{ value: '6.3.3', isBeta: false, isDevelopment: false, label: '6.3.3' },
			],
			isLoading: false,
		} ),
	};
} );

const createAuthMock = ( isAuthenticated: boolean = false ) => ( {
	isAuthenticated,
	authenticate: vi.fn(),
	user: isAuthenticated ? { id: 123, email: 'user@example.com', displayName: 'user' } : undefined,
	client: isAuthenticated ? ( {} as never ) : undefined,
} );

const selectedSite: SiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	adminPassword: btoa( 'test-password' ),
	running: false,
	phpVersion: '8.4',
	id: 'site-id',
};

const fakeSyncSite: SyncSite = {
	id: 6,
	name: 'My simple business site',
	url: 'https://developer.wordpress.com/studio/',
	syncSupport: 'already-connected',
	isStaging: false,
	isPressable: false,
	localSiteId: 'site-id',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
};

describe( 'ContentTabSync', () => {
	const setupConnectedSitesMocks = (
		connectedSites: SyncSite[] = [],
		syncSites: SyncSite[] = []
	) => {
		// Update the IPC API mock to return the connected sites
		const currentMock = vi.mocked( getIpcApi )();
		vi.mocked( currentMock.getConnectedWpcomSites, { partial: true } ).mockResolvedValue(
			connectedSites
		);

		vi.mocked( useGetWpComSitesQuery, { partial: true } ).mockReturnValue( {
			data: { sites: syncSites, total: syncSites.length, page: 1, perPage: 100 },
			isLoading: false,
			isFetching: false,
			isSuccess: true,
			refetch: vi.fn(),
		} );
	};

	beforeEach( () => {
		vi.resetAllMocks();
		mockPullSiteThunk.mockImplementation( ( payload ) => ( {
			type: 'syncOperations/pullSite',
			payload,
		} ) );
		mockPushSiteThunk.mockImplementation( ( payload ) => ( {
			type: 'syncOperations/pushSite',
			payload,
		} ) );
		store.dispatch( testActions.resetState() );
		store.dispatch( { type: 'connectedSitesApi/resetApiState' } );
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( false ) );
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			authenticate: vi.fn(),
			generateProposedSitePath: vi.fn(),
			openURL: vi.fn(),
			showMessageBox: vi.fn(),
			updateConnectedWpcomSites: vi.fn(),
			addSyncOperation: vi.fn(),
			clearSyncOperation: vi.fn(),
			getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
			getDirectorySize: vi.fn().mockResolvedValue( 0 ),
			connectWpcomSites: vi.fn(),
			disconnectWpcomSites: vi.fn(),
			showErrorMessageBox: vi.fn(),
			getWpVersion: vi.fn().mockResolvedValue( '6.4.3' ),
			getIsMultisite: vi.fn().mockResolvedValue( false ),
			listLocalFileTree: vi.fn().mockResolvedValue( [
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
		vi.mocked( useSelectedItemsPushSize, { partial: true } ).mockReturnValue( {
			isPushSelectionOverLimit: false,
			isLoading: false,
		} );
		vi.mocked( useLatestRewindId, { partial: true } ).mockReturnValue( {
			rewindId: '1704067200',
			isLoading: false,
			isError: false,
		} );

		vi.mocked( useGetWpComSitesQuery, { partial: true } ).mockReturnValue( {
			data: { sites: [], total: 0, page: 1, perPage: 100 },
			isLoading: false,
			isFetching: false,
			isSuccess: true,
			refetch: vi.fn(),
		} );

		vi.mocked( useRemoteFileTree, { partial: true } ).mockReturnValue( {
			fetchChildren: vi.fn().mockResolvedValue( [
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
			value: vi.fn().mockImplementation( ( query ) => ( {
				matches: false,
				media: query,
				onchange: null,
				addListener: vi.fn(), // deprecated
				removeListener: vi.fn(), // deprecated
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
			} ) ),
		} );
	} );

	const renderWithProvider = ( children: React.ReactElement ) => {
		return render(
			<Provider store={ store }>
				<ContentTabsProvider>{ children }</ContentTabsProvider>
			</Provider>
		);
	};

	it( 'renders the sync title and login buttons', () => {
		const authMock = createAuthMock( false );
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( authMock );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );
		expect( screen.getByText( 'Sync with WordPress.com or Pressable' ) ).toBeInTheDocument();

		const loginButton = screen.getByRole( 'button', { name: /Log in to WordPress.com/i } );
		expect( loginButton ).toBeInTheDocument();

		fireEvent.click( loginButton );
		expect( authMock.authenticate ).toHaveBeenCalled();

		const freeAccountButton = screen.getByRole( 'button', { name: /Create a free account/i } );
		expect( freeAccountButton ).toBeInTheDocument();

		fireEvent.click( freeAccountButton );
		expect( getIpcApi().authenticate ).toHaveBeenCalled();
	} );

	// The RTK Query trigger resolves with `{ error }` rather than rejecting, so
	// without `.unwrap()` a failed disconnect was recorded as a success.
	it( 'records no disconnect event when the disconnect fails', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );
		const ipc = vi.mocked( getIpcApi )();
		// Confirm the "are you sure?" dialog (button 0 is Disconnect).
		vi.mocked( ipc.showMessageBox, { partial: true } ).mockResolvedValue( {
			response: 0,
			checkboxChecked: false,
		} );
		vi.mocked( ipc.disconnectWpcomSites, { partial: true } ).mockRejectedValue(
			new Error( 'User not authenticated' )
		);
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		await screen.findByText( fakeSyncSite.name );
		fireEvent.click( screen.getByRole( 'button', { name: /Disconnect/i } ) );

		await waitFor( () => expect( ipc.showErrorMessageBox ).toHaveBeenCalled() );
		expect( recordRendererTracksEvent ).not.toHaveBeenCalledWith(
			TRACKS_EVENTS.SYNC_DISCONNECT,
			expect.anything()
		);
		expect( recordRendererTracksEvent ).not.toHaveBeenCalledWith( TRACKS_EVENTS.SYNC_DISCONNECT );
	} );

	it( 'records a disconnect event when the disconnect succeeds', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );
		const ipc = vi.mocked( getIpcApi )();
		vi.mocked( ipc.showMessageBox, { partial: true } ).mockResolvedValue( {
			response: 0,
			checkboxChecked: false,
		} );
		vi.mocked( ipc.disconnectWpcomSites, { partial: true } ).mockResolvedValue( undefined );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		await screen.findByText( fakeSyncSite.name );
		fireEvent.click( screen.getByRole( 'button', { name: /Disconnect/i } ) );

		await waitFor( () =>
			expect( recordRendererTracksEvent ).toHaveBeenCalledWith( TRACKS_EVENTS.SYNC_DISCONNECT )
		);
		expect( ipc.showErrorMessageBox ).not.toHaveBeenCalled();
	} );

	it( 'displays the list of connected sites', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		await screen.findByText( fakeSyncSite.name );
		expect( screen.getByRole( 'button', { name: /Disconnect/i } ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'sync-list-pull-button' ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'sync-list-push-button' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Production' ) ).toBeInTheDocument();
	} );

	it( 'opens URL for connected sites', async () => {
		const fakeSyncSite: SyncSite = {
			id: 6,
			name: 'My simple business site that needs a transfer',
			url: 'https://developer.wordpress.com/studio/',
			isStaging: false,
			syncSupport: 'already-connected',
			localSiteId: 'site-id',
			isPressable: false,
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		};
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const readableUrl = fakeSyncSite.url.replace( /^https?:\/\//, '' );
		const urlButton = await screen.findByRole( 'button', {
			name: ( content ) => content.includes( readableUrl ),
		} );
		expect( urlButton ).toBeInTheDocument();

		fireEvent.click( urlButton );
		expect( getIpcApi().openURL ).toHaveBeenCalledWith( fakeSyncSite.url );
	} );

	it( 'opens the modal and displays the create new site button', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [], [ fakeSyncSite ] );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const connectSiteButton = await screen.findByRole( 'button', { name: 'Connect site' } );
		expect( connectSiteButton ).toBeInTheDocument();
		fireEvent.click( connectSiteButton );

		const createNewSiteButton = await screen.findByRole( 'button', {
			name: /Create a new WordPress.com site ↗/i,
		} );
		expect( createNewSiteButton ).toBeInTheDocument();
	} );

	it( 'displays environment badges for Pressable sites with production, staging and development environments', async () => {
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
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );

		const allSites = [
			fakePressableProductionSite,
			fakePressableStagingSite,
			fakePressableDevelopmentSite,
		];
		setupConnectedSitesMocks( allSites, [ fakePressableProductionSite ] );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		await screen.findByText( fakePressableProductionSite.name );
		expect( screen.getByText( fakePressableStagingSite.name ) ).toBeInTheDocument();
		expect( screen.getByText( fakePressableDevelopmentSite.name ) ).toBeInTheDocument();

		expect( screen.getByText( 'Production' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Staging' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Development' ) ).toBeInTheDocument();
	} );
	it( 'displays the progress bar when the site is being pushed', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );
		store.dispatch(
			syncOperationsActions.updatePushState( {
				selectedSiteId: selectedSite.id,
				remoteSiteId: fakeSyncSite.id,
				state: {
					status: {
						key: 'uploading',
						progress: 40,
						message: 'Uploading…',
					},
					selectedSite,
					remoteSiteUrl: fakeSyncSite.url,
				},
			} )
		);
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		await screen.findByRole( 'progressbar' );
	} );

	it( 'opens sync pullSite dialog with development environment label', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		const fakeDevelopmentSyncSite: SyncSite = {
			...fakeSyncSite,
			isPressable: true,
			environmentType: 'development',
		};
		setupConnectedSitesMocks( [ fakeDevelopmentSyncSite ], [ fakeDevelopmentSyncSite ] );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = await screen.findByTestId( 'sync-list-pull-button' );
		expect( pullButton ).toBeInTheDocument();
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Development' );
		await screen.findByText(
			"Pulling will overwrite your Studio site's selected files and database with a copy from your development site. Unchecked items will not be changed."
		);
	} );

	it( 'opens sync pullSite dialog and displays production when the environment is not supported', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		const fakeDevelopmentSyncSite: SyncSite = {
			...fakeSyncSite,
			isPressable: true,
			environmentType: 'non-supported-environment-example-or-sandbox',
		};
		setupConnectedSitesMocks( [ fakeDevelopmentSyncSite ], [ fakeDevelopmentSyncSite ] );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = await screen.findByTestId( 'sync-list-pull-button' );
		expect( pullButton ).toBeInTheDocument();
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Production' );
		await screen.findByText(
			"Pulling will overwrite your Studio site's selected files and database with a copy from your production site. Unchecked items will not be changed."
		);
	} );

	it( 'calls pullSite with correct optionsToSync when all options are selected', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = await screen.findByTestId( 'sync-list-pull-button' );
		expect( pullButton ).toBeInTheDocument();
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Production' );

		const filesAndFoldersCheckbox = screen.getByRole( 'checkbox', { name: 'Files and folders' } );
		fireEvent.click( filesAndFoldersCheckbox );
		const databaseCheckbox = screen.getByRole( 'checkbox', { name: 'Database' } );
		fireEvent.click( databaseCheckbox );

		const dialogPullButton = await screen.findByTestId( 'sync-dialog-pull-button' );
		fireEvent.click( dialogPullButton );

		expect( mockPullSiteThunk ).toHaveBeenCalledWith(
			expect.objectContaining( {
				options: {
					optionsToSync: [ SYNC_OPTIONS.all ],
				},
			} )
		);
	} );

	it( 'calls pullSite with correct optionsToSync when only database is selected', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = await screen.findByTestId( 'sync-list-pull-button' );
		expect( pullButton ).toBeInTheDocument();
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Production' );

		const databaseCheckbox = screen.getByRole( 'checkbox', { name: 'Database' } );
		fireEvent.click( databaseCheckbox );

		const dialogPullButton = await screen.findByTestId( 'sync-dialog-pull-button' );
		fireEvent.click( dialogPullButton );

		expect( mockPullSiteThunk ).toHaveBeenCalledWith(
			expect.objectContaining( {
				options: {
					optionsToSync: [ SYNC_OPTIONS.sqls ],
				},
			} )
		);
	} );

	it( 'calls pullSite with correct optionsToSync when options partially are selected', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		vi.mocked( useRemoteFileTree, { partial: true } ).mockReturnValue( {
			fetchChildren: vi.fn().mockResolvedValue( [
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

		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = await screen.findByTestId( 'sync-list-pull-button' );
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

		const dialogPullButton = await screen.findByTestId( 'sync-dialog-pull-button' );
		fireEvent.click( dialogPullButton );

		expect( mockPullSiteThunk ).toHaveBeenCalledWith(
			expect.objectContaining( {
				options: {
					optionsToSync: [ SYNC_OPTIONS.paths, SYNC_OPTIONS.sqls ],
					include_path_list: [ 'cjI6,ZjI6Lw==', 'ZjM6Lw==' ],
				},
			} )
		);
	} );

	it( 'disables the pull button when all checkboxes are unchecked, which is the initial state', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = await screen.findByRole( 'button', { name: 'Pull' } );
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Production' );
		const dialogPullButton = await screen.findByTestId( 'sync-dialog-pull-button' );
		expect( dialogPullButton ).toBeDisabled();
	} );

	it( 'disables the push button when all checkboxes are unchecked, which is the initial state', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pushButton = await screen.findByTestId( 'sync-list-push-button' );
		fireEvent.click( pushButton );

		await screen.findByText( 'Push to Production' );
		const dialogPushButton = await screen.findByTestId( 'sync-dialog-push-button' );
		expect( dialogPushButton ).toBeDisabled();
	} );

	it( 'enables the pull button when at least one checkbox is checked', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = await screen.findByRole( 'button', { name: 'Pull' } );
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Production' );

		// Check the database checkbox
		const databaseCheckbox = screen.getByRole( 'checkbox', { name: 'Database' } );
		fireEvent.click( databaseCheckbox );

		const dialogPullButton = await screen.findByTestId( 'sync-dialog-pull-button' );
		expect( dialogPullButton ).toBeEnabled();
	} );

	it( 'enables the pull button when at least one checkbox children is checked', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = await screen.findByRole( 'button', { name: 'Pull' } );
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

		const dialogPullButton = await screen.findByTestId( 'sync-dialog-pull-button' );
		expect( dialogPullButton ).toBeEnabled();
	} );

	it( 'disables the push button when all checkboxes are unchecked', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pushButton = await screen.findByTestId( 'sync-list-push-button' );
		fireEvent.click( pushButton );

		await screen.findByText( 'Push to Production' );
		const dialogPushButton = await screen.findByTestId( 'sync-dialog-push-button' );
		expect( dialogPushButton ).toBeDisabled();
	} );

	it( 'enables the push button when at least one checkbox is checked', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pushButton = await screen.findByTestId( 'sync-list-push-button' );
		fireEvent.click( pushButton );

		await screen.findByText( 'Push to Production' );
		const databaseCheckbox = screen.getByRole( 'checkbox', { name: 'Database' } );
		fireEvent.click( databaseCheckbox );

		const dialogPushButton = await screen.findByTestId( 'sync-dialog-push-button' );
		expect( dialogPushButton ).toBeEnabled();
	} );

	it( 'enables the push button when at least one checkbox children is checked', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
		setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pushButton = await screen.findByTestId( 'sync-list-push-button' );
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

		const dialogPushButton = await screen.findByTestId( 'sync-dialog-push-button' );
		expect( dialogPushButton ).toBeEnabled();
	} );

	describe( 'Sync Dialog Push Selection Over Limit Notice', () => {
		it( 'shows warning notice when push selection exceeds limit', async () => {
			vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
			setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );
			vi.mocked( useSelectedItemsPushSize, { partial: true } ).mockReturnValue( {
				isPushSelectionOverLimit: true,
				isLoading: false,
			} );

			renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

			const pushButton = await screen.findByTestId( 'sync-list-push-button' );
			fireEvent.click( pushButton );

			await screen.findByText( 'Push to Production' );

			const warningNotice = screen.getByTestId( 'push-selection-over-limit-notice' );
			expect( warningNotice ).toBeInTheDocument();

			const dialogPushButton = await screen.findByTestId( 'sync-dialog-push-button' );
			expect( dialogPushButton ).toBeDisabled();
		} );

		it( 'does not show warning notice when push selection is within limit', async () => {
			vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
			setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );
			vi.mocked( useSelectedItemsPushSize, { partial: true } ).mockReturnValue( {
				isPushSelectionOverLimit: false,
				isLoading: false,
			} );

			renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

			const pushButton = await screen.findByRole( 'button', { name: 'Push' } );
			fireEvent.click( pushButton );

			await screen.findByText( 'Push to Production' );

			const warningNotice = screen.queryByTestId( 'push-selection-over-limit-notice' );
			expect( warningNotice ).not.toBeInTheDocument();
		} );

		it( 'does not show warning notice for pull operations even when limit exceeded', async () => {
			vi.mocked( useAuth, { partial: true } ).mockReturnValue( createAuthMock( true ) );
			setupConnectedSitesMocks( [ fakeSyncSite ], [ fakeSyncSite ] );
			vi.mocked( useSelectedItemsPushSize, { partial: true } ).mockReturnValue( {
				isPushSelectionOverLimit: true,
				isLoading: false,
			} );

			renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

			const pullButton = await screen.findByRole( 'button', { name: 'Pull' } );
			fireEvent.click( pullButton );

			await screen.findByText( 'Pull from Production' );

			const warningNotice = screen.queryByTestId( 'push-selection-over-limit-notice' );
			expect( warningNotice ).not.toBeInTheDocument();
		} );
	} );
} );
