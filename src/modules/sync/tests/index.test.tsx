// To run tests, execute `npm run test -- src/modules/sync/tests/index.test.tsx` from the root directory
import { render, screen, fireEvent } from '@testing-library/react';
import escapeRegExp from 'lodash/escapeRegExp';
import { Provider } from 'react-redux';
import { SyncSitesProvider, useSyncSites } from 'src/hooks/sync-sites';
import { useLatestRewindId } from 'src/hooks/sync-sites/use-latest-rewind-id';
import { SyncPushState } from 'src/hooks/sync-sites/use-sync-push';
import { useAuth } from 'src/hooks/use-auth';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ContentTabSync } from 'src/modules/sync';
import { store } from 'src/stores';

jest.mock( 'src/hooks/use-auth' );
jest.mock( 'src/lib/get-ipc-api' );
jest.mock( 'src/hooks/sync-sites/sync-sites-context', () => ( {
	...jest.requireActual( '../../../hooks/sync-sites/sync-sites-context' ),
	useSyncSites: jest.fn(),
} ) );

jest.mock( 'src/hooks/sync-sites/use-latest-rewind-id', () => ( {
	useLatestRewindId: jest.fn(),
} ) );

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
	url: 'https:/developer.wordpress.com/studio/',
	syncSupport: 'already-connected',
};

describe( 'ContentTabSync', () => {
	const mockSyncSites = {
		connectedSites: [],
		syncSites: [],
		pullSite: jest.fn(),
		isAnySitePulling: false,
		isAnySitePushing: false,
		getPullState: jest.fn(),
		getPushState: jest.fn().mockReturnValue( inProgressPushState ),
		refetchSites: jest.fn(),
		updateTimestamp: jest.fn(),
		getLastSyncTimeWithType: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
		isSiteIdPulling: jest.fn(),
		isSiteIdPushing: jest.fn(),
		clearTimeout: jest.fn(),
		isSyncSitesSelectorOpen: false,
		setIsSyncSitesSelectorOpen: jest.fn(),
		closeSyncSitesSelector: jest.fn(),
	};
	beforeEach( () => {
		jest.resetAllMocks();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate: jest.fn() } );
		( getIpcApi as jest.Mock ).mockReturnValue( {
			authenticate: jest.fn(),
			generateProposedSitePath: jest.fn(),
			openURL: jest.fn(),
			showMessageBox: jest.fn(),
			updateConnectedWpcomSites: jest.fn(),
		} );
		( useSyncSites as jest.Mock ).mockReturnValue( mockSyncSites );
		( useLatestRewindId as jest.Mock ).mockReturnValue( {
			rewindId: '1704067200',
			isLoading: false,
			error: null,
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

	it( 'displays connect site button to authenticated user', () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );
		const connectSiteButton = screen.getByRole( 'button', { name: /Connect site/i } );

		expect( connectSiteButton ).toBeInTheDocument();
	} );

	it( 'opens the site selector modal to connect a site authenticated user', () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );
		const connectSiteButton = screen.getByRole( 'button', { name: /Connect site/i } );
		fireEvent.click( connectSiteButton );

		( useSyncSites as jest.Mock ).mockReturnValue( {
			...useSyncSites(),
			isSyncSitesSelectorOpen: true,
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );
		expect( screen.getByTestId( 'sync-sites-modal-selector' ) ).toBeInTheDocument();
	} );

	it( 'displays the list of connected sites', async () => {
		const fakeSyncSite = {
			id: 6,
			name: 'My simple business site that needs a transfer',
			url: 'https:/developer.wordpress.com/studio/',
			isStaging: false,
			stagingSiteIds: [],
			syncSupport: 'already-connected',
		};
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
			syncSites: [ fakeSyncSite ],
			pullSite: jest.fn(),
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn().mockReturnValue( undefined ),
			refetchSites: jest.fn(),
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
			url: 'https:/developer.wordpress.com/studio/',
			isStaging: false,
			stagingSiteIds: [],
			syncSupport: 'already-connected',
		};
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
			syncSites: [ fakeSyncSite ],
			pullSite: jest.fn(),
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn().mockReturnValue( inProgressPushState ),
			refetchSites: jest.fn(),
			getLastSyncTimeText: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
			isSiteIdPulling: jest.fn(),
			isSiteIdPushing: jest.fn(),
			clearTimeout: jest.fn(),
		} );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const urlButton = screen.getByRole( 'button', {
			name: new RegExp( escapeRegExp( fakeSyncSite.url ), 'i' ),
		} );
		expect( urlButton ).toBeInTheDocument();

		fireEvent.click( urlButton );
		expect( getIpcApi().openURL ).toHaveBeenCalledWith( fakeSyncSite.url );
	} );

	it( 'displays both production and staging sites when a production site is connected', async () => {
		const fakeProductionSite = {
			id: 6,
			name: 'My simple business site',
			url: 'https://developer.wordpress.com/studio/',
			isStaging: false,
			stagingSiteIds: [ 7 ],
			syncSupport: 'already-connected',
		};
		const fakeStagingSite = {
			id: 7,
			name: 'Staging: My simple business site',
			url: 'https://developer-staging.wordpress.com/studio/',
			isStaging: true,
			stagingSiteIds: [],
			syncSupport: 'already-connected',
		};
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );

		( useSyncSites as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeProductionSite, fakeStagingSite ],
			syncSites: [ fakeProductionSite ],
			pullSite: jest.fn(),
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn().mockReturnValue( undefined ),
			refetchSites: jest.fn(),
			getLastSyncTimeText: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
			isSiteIdPulling: jest.fn(),
			isSiteIdPushing: jest.fn(),
			clearTimeout: jest.fn(),
		} );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		expect( screen.getByText( fakeProductionSite.name ) ).toBeInTheDocument();
		expect( screen.getByText( 'Production' ) ).toBeInTheDocument();

		expect( screen.queryByText( fakeStagingSite.name ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Staging' ) ).toBeInTheDocument();

		const disconnectButtons = screen.getAllByRole( 'button', { name: /Disconnect/i } );
		expect( disconnectButtons ).toHaveLength( 1 );

		const pullButtons = screen.getAllByRole( 'button', { name: /Pull/i } );
		expect( pullButtons ).toHaveLength( 2 );

		const pushButtons = screen.getAllByRole( 'button', { name: /Push/i } );
		expect( pushButtons ).toHaveLength( 2 );

		const productionUrl = screen.getAllByRole( 'button', {
			name: 'developer.wordpress.com/studio/ ↗',
		} );
		expect( productionUrl ).toHaveLength( 1 );

		const stagingUrl = screen.getAllByRole( 'button', {
			name: 'developer-staging.wordpress.com/studio/ ↗',
		} );
		expect( stagingUrl ).toHaveLength( 1 );
	} );

	it( 'opens the modal and displays the create new site button', () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );
		const connectSiteButton = screen.getByRole( 'button', { name: /Connect site/i } );
		fireEvent.click( connectSiteButton );

		expect( useSyncSites().setIsSyncSitesSelectorOpen ).toHaveBeenCalledWith( true );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			...useSyncSites(),
			isSyncSitesSelectorOpen: true,
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );
		const createNewSiteButton = screen.getByRole( 'button', {
			name: /Create a new WordPress.com site ↗/i,
		} );
		expect( createNewSiteButton ).toBeInTheDocument();
	} );

	it( 'displays ConnectButton when there are no connected sites', () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const connectButton = screen.getByRole( 'button', { name: /Connect site/i } );
		expect( connectButton ).toBeInTheDocument();
	} );

	it( 'displays the ConnectButton at the bottom when there are multiple connected sites', () => {
		const fakeSyncSite = {
			id: 6,
			name: 'My simple business site',
			url: 'https://developer.wordpress.com/studio/',
			isStaging: false,
			stagingSiteIds: [],
			syncSupport: 'already-connected',
		};

		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
			syncSites: [ fakeSyncSite ],
			pullSite: jest.fn(),
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn().mockReturnValue( undefined ),
			refetchSites: jest.fn(),
			getLastSyncTimeText: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
			isSiteIdPulling: jest.fn(),
			isSiteIdPushing: jest.fn(),
			clearTimeout: jest.fn(),
			isSyncSitesSelectorOpen: false,
			setIsSyncSitesSelectorOpen: jest.fn(),
			closeSyncSitesSelector: jest.fn(),
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const connectButton = screen.getByRole( 'button', { name: /Connect another site/i } );
		expect( connectButton ).toBeInTheDocument();
	} );

	it( 'displays environment badges for Pressable sites with production, staging and sandbox environments', () => {
		const fakePressableProductionSite = {
			id: 6,
			name: 'My Pressable Production site',
			url: 'https://pressable-site.com',
			isStaging: false,
			isPressable: true,
			environmentType: 'production',
			stagingSiteIds: [],
			syncSupport: 'already-connected',
		};
		const fakePressableStagingSite = {
			id: 7,
			name: 'My Pressable Staging site',
			url: 'https://staging-pressable-site.com',
			isStaging: false,
			isPressable: true,
			environmentType: 'staging',
			stagingSiteIds: [],
			syncSupport: 'already-connected',
		};
		const fakePressableSandboxSite = {
			id: 8,
			name: 'My Pressable Sandbox site',
			url: 'https://sandbox-pressable-site.com',
			isStaging: false,
			isPressable: true,
			environmentType: 'sandbox',
			stagingSiteIds: [],
			syncSupport: 'already-connected',
		};
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			connectedSites: [
				fakePressableProductionSite,
				fakePressableStagingSite,
				fakePressableSandboxSite,
			],
			syncSites: [ fakePressableProductionSite ],
			pullSite: jest.fn(),
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn().mockReturnValue( undefined ),
			refetchSites: jest.fn(),
			getLastSyncTimeText: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
			isSiteIdPulling: jest.fn(),
			isSiteIdPushing: jest.fn(),
			clearTimeout: jest.fn(),
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		expect( screen.getByText( fakePressableProductionSite.name ) ).toBeInTheDocument();
		expect( screen.getByText( fakePressableStagingSite.name ) ).toBeInTheDocument();
		expect( screen.getByText( fakePressableSandboxSite.name ) ).toBeInTheDocument();

		expect( screen.getByText( 'Production' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Staging' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Sandbox' ) ).toBeInTheDocument();
	} );
	it( 'displays the progress bar when the site is being pushed', () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		const fakeSyncSite = {
			id: 6,
			name: 'My simple business site that needs a transfer',
			url: 'https:/developer.wordpress.com/studio/',
			syncSupport: 'already-connected',
		};
		( useSyncSites as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
			syncSites: [ fakeSyncSite ],
			pullSite: jest.fn(),
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn().mockReturnValue( inProgressPushState ),
			refetchSites: jest.fn(),
			getLastSyncTimeText: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
			isSiteIdPulling: jest.fn(),
			isSiteIdPushing: jest.fn().mockReturnValue( true ),
			clearTimeout: jest.fn(),
		} );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		expect( screen.getByRole( 'progressbar' ) ).toBeInTheDocument();
	} );

	it( 'opens sync pullSite dialog with sandbox environment label', async () => {
		const mockPullSite = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		const fakeSyncSite = {
			id: 6,
			name: 'My simple business site that needs a transfer',
			url: 'https:/developer.wordpress.com/studio/',
			syncSupport: 'already-connected',
			isPressable: true,
			environmentType: 'sandbox',
		};
		( useSyncSites as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
			syncSites: [ fakeSyncSite ],
			pullSite: mockPullSite,
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn(),
			refetchSites: jest.fn(),
			getLastSyncTimeText: jest.fn().mockReturnValue( 'You have not pulled this site yet.' ),
			isSiteIdPulling: jest.fn(),
			isSiteIdPushing: jest.fn(),
			clearTimeout: jest.fn(),
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = screen.getByRole( 'button', { name: /Pull/i } );
		expect( pullButton ).toBeInTheDocument();
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Sandbox' );
		await screen.findByText(
			"Pulling will overwrite your Studio site's selected files and database with a copy from your sandbox site. Unchecked items will not be changed."
		);
	} );

	it( 'calls pullSite with correct optionsToSync when all options are selected', async () => {
		const mockPullSite = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		const fakeSyncSite = {
			id: 6,
			name: 'My simple business site that needs a transfer',
			url: 'https:/developer.wordpress.com/studio/',
			syncSupport: 'already-connected',
		};
		( useSyncSites as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
			syncSites: [ fakeSyncSite ],
			pullSite: mockPullSite,
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn(),
			refetchSites: jest.fn(),
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

		const dialogPullButton = screen.getAllByRole( 'button', { name: /Pull/i } );
		fireEvent.click( dialogPullButton[ 1 ] );

		expect( mockPullSite ).toHaveBeenCalledWith( fakeSyncSite, selectedSite, {
			options: [ 'sqls' ],
			rewindId: '1704067200',
		} );
	} );

	it( 'calls pullSite with correct optionsToSync when options partially are selected', async () => {
		const mockPullSite = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		const fakeSyncSite = {
			id: 6,
			name: 'My simple business site that needs a transfer',
			url: 'https:/developer.wordpress.com/studio/',
			syncSupport: 'already-connected',
		};
		( useSyncSites as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
			syncSites: [ fakeSyncSite ],
			pullSite: mockPullSite,
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn(),
			refetchSites: jest.fn(),
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

		const select = screen.getByRole( 'combobox', { name: 'Select files and folders to sync' } );
		fireEvent.change( select, { target: { value: true } } );

		fireEvent.click( screen.getByText( 'themes' ) );

		const dialogPullButton = screen.getAllByRole( 'button', { name: /Pull/i } );
		fireEvent.click( dialogPullButton[ 1 ] );

		expect( mockPullSite ).toHaveBeenCalledWith( fakeSyncSite, selectedSite, {
			options: [ 'sqls' ],
			rewindId: '1704067200',
		} );
	} );

	it( 'disables the pull button when all checkboxes are unchecked', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			...mockSyncSites,
			connectedSites: [ fakeSyncSite ],
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = screen.getByRole( 'button', { name: /Pull/i } );
		fireEvent.click( pullButton );

		await screen.findByText( 'Pull from Production' );

		// Uncheck all checkboxes
		const filesAndFoldersCheckbox = screen.getByRole( 'checkbox', { name: 'Files and folders' } );
		fireEvent.click( filesAndFoldersCheckbox );
		const databaseCheckbox = screen.getByRole( 'checkbox', { name: 'Database' } );
		fireEvent.click( databaseCheckbox );

		const dialogPullButton = screen.getAllByRole( 'button', { name: /Pull/i } )[ 1 ];
		expect( dialogPullButton ).toBeDisabled();
	} );

	it( 'enables the pull button when at least one checkbox is checked', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			...mockSyncSites,
			connectedSites: [ fakeSyncSite ],
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = screen.getByRole( 'button', { name: /Pull/i } );
		fireEvent.click( pullButton );

		// Uncheck one option, the databases
		const filesAndFoldersCheckbox = screen.getByRole( 'checkbox', { name: 'Files and folders' } );
		fireEvent.click( filesAndFoldersCheckbox );

		await screen.findByText( 'Pull from Production' );
		const dialogPullButton = screen.getAllByRole( 'button', { name: /Pull/i } )[ 1 ];
		expect( dialogPullButton ).not.toBeDisabled();
	} );

	it( 'enables the pull button when at least one checkbox children is checked', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			...mockSyncSites,
			connectedSites: [ fakeSyncSite ],
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pullButton = screen.getByRole( 'button', { name: /Pull/i } );
		fireEvent.click( pullButton );

		// leave checked only one children option
		const filesAndFoldersCheckbox = screen.getByRole( 'checkbox', { name: 'Files and folders' } );
		fireEvent.click( filesAndFoldersCheckbox );
		const databaseCheckbox = screen.getByRole( 'checkbox', { name: 'Database' } );
		fireEvent.click( databaseCheckbox );
		const select = screen.getByRole( 'combobox', { name: 'Select files and folders to sync' } );
		fireEvent.change( select, { target: { value: true } } );
		const pluginsCheckbox = screen.getByRole( 'checkbox', { name: 'plugins' } );
		fireEvent.click( pluginsCheckbox );

		expect( pluginsCheckbox ).toBeChecked();
		expect( databaseCheckbox ).not.toBeChecked();
		expect( filesAndFoldersCheckbox ).not.toBeChecked();

		await screen.findByText( 'Pull from Production' );
		const dialogPullButton = screen.getAllByRole( 'button', { name: /Pull/i } )[ 1 ];
		expect( dialogPullButton ).not.toBeDisabled();
	} );
	it( 'disables the push button when all checkboxes are unchecked', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			...mockSyncSites,
			connectedSites: [ fakeSyncSite ],
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pushButton = screen.getByRole( 'button', { name: /Push/i } );
		fireEvent.click( pushButton );

		await screen.findByText( 'Push to Production' );

		// Uncheck all checkboxes
		const filesAndFoldersCheckbox = screen.getByRole( 'checkbox', { name: 'Files and folders' } );
		fireEvent.click( filesAndFoldersCheckbox );
		const databaseCheckbox = screen.getByRole( 'checkbox', { name: 'Database' } );
		fireEvent.click( databaseCheckbox );

		const dialogPushButton = screen.getAllByRole( 'button', { name: /Push/i } )[ 1 ];
		expect( dialogPushButton ).toBeDisabled();
	} );

	it( 'enables the push button when at least one checkbox is checked', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			...mockSyncSites,
			connectedSites: [ fakeSyncSite ],
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pushButton = screen.getByRole( 'button', { name: /Push/i } );
		fireEvent.click( pushButton );

		// Uncheck one option, the databases
		const filesAndFoldersCheckbox = screen.getByRole( 'checkbox', { name: 'Files and folders' } );
		fireEvent.click( filesAndFoldersCheckbox );

		await screen.findByText( 'Push to Production' );
		const dialogPushButton = screen.getAllByRole( 'button', { name: /Push/i } )[ 1 ];
		expect( dialogPushButton ).not.toBeDisabled();
	} );

	it( 'enables the push button when at least one checkbox children is checked', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			...mockSyncSites,
			connectedSites: [ fakeSyncSite ],
		} );

		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const pushButton = screen.getByRole( 'button', { name: /Push/i } );
		fireEvent.click( pushButton );

		// leave checked only one children option
		const filesAndFoldersCheckbox = screen.getByRole( 'checkbox', { name: 'Files and folders' } );
		fireEvent.click( filesAndFoldersCheckbox );
		const databaseCheckbox = screen.getByRole( 'checkbox', { name: 'Database' } );
		fireEvent.click( databaseCheckbox );
		const select = screen.getByRole( 'combobox', { name: 'Select files and folders to sync' } );
		fireEvent.change( select, { target: { value: true } } );
		const pluginsCheckbox = screen.getByRole( 'checkbox', { name: 'plugins' } );
		fireEvent.click( pluginsCheckbox );

		expect( pluginsCheckbox ).toBeChecked();
		expect( databaseCheckbox ).not.toBeChecked();
		expect( filesAndFoldersCheckbox ).not.toBeChecked();

		await screen.findByText( 'Push to Production' );
		const dialogPushButton = screen.getAllByRole( 'button', { name: /Push/i } )[ 1 ];
		expect( dialogPushButton ).not.toBeDisabled();
	} );
} );
