// To run tests, execute `npm run test -- src/components/tests/content-tab-sync.test.tsx` from the root directory
import { render, screen, fireEvent } from '@testing-library/react';
import { SyncSitesProvider, useSyncSites } from '../../hooks/sync-sites';
import { useAuth } from '../../hooks/use-auth';
import { getIpcApi } from '../../lib/get-ipc-api';
import { ContentTabSync } from '../content-tab-sync';

jest.mock( '../../hooks/use-auth' );
jest.mock( '../../lib/get-ipc-api' );
jest.mock( '../../hooks/sync-sites/sync-sites-context', () => ( {
	...jest.requireActual( '../../hooks/sync-sites/sync-sites-context' ),
	useSyncSites: jest.fn(),
} ) );

const selectedSite: SiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	adminPassword: btoa( 'test-password' ),
	running: false,
	phpVersion: '8.0',
	id: 'site-id',
};

const defaultPushState = {
	remoteSiteId: 1,
	status: null,
	selectedSite,
	isStaging: false,
	isInProgress: false,
	isError: false,
	hasFinished: false,
};

describe( 'ContentTabSync', () => {
	beforeEach( () => {
		jest.resetAllMocks();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate: jest.fn() } );
		( getIpcApi as jest.Mock ).mockReturnValue( {
			openURL: jest.fn(),
			generateProposedSitePath: jest.fn(),
			showMessageBox: jest.fn(),
			updateConnectedWpcomSites: jest.fn(),
		} );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			connectedSites: [],
			syncSites: [],
			pullSite: jest.fn(),
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn().mockReturnValue( defaultPushState ),
			refetchSites: jest.fn(),
		} );
	} );

	const renderWithProvider = ( children: React.ReactElement ) => {
		return render( <SyncSitesProvider>{ children }</SyncSitesProvider> );
	};

	it( 'renders the sync title and login buttons', () => {
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );
		expect( screen.getByText( 'Sync with' ) ).toBeInTheDocument();

		const loginButton = screen.getByRole( 'button', { name: /Log in to WordPress.com/i } );
		expect( loginButton ).toBeInTheDocument();

		fireEvent.click( loginButton );
		expect( useAuth().authenticate ).toHaveBeenCalled();

		const freeAccountButton = screen.getByRole( 'button', { name: /Create a free account/i } );
		expect( freeAccountButton ).toBeInTheDocument();

		fireEvent.click( freeAccountButton );
		expect( getIpcApi().openURL ).toHaveBeenCalled();
	} );

	it( 'displays create new site button to authenticated user', () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );
		const createSiteButton = screen.getByRole( 'button', { name: /Create new site/i } );
		fireEvent.click( createSiteButton );

		expect( screen.getByText( 'Sync with' ) ).toBeInTheDocument();
		expect( createSiteButton ).toBeInTheDocument();
		expect( getIpcApi().openURL ).toHaveBeenCalledWith( 'https://wordpress.com/start/new-site' );
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
		expect( screen.getByText( 'Connect a WordPress.com site' ) ).toBeInTheDocument();
	} );

	it( 'displays the list of connected sites', async () => {
		const fakeSyncSite = {
			id: 6,
			name: 'My simple business site that needs a transfer',
			url: 'https:/developer.wordpress.com/studio/',
			isStaging: false,
			stagingSiteIds: [],
			syncSupport: 'syncable',
		};
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
			syncSites: [ fakeSyncSite ],
			pullSite: jest.fn(),
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn().mockReturnValue( defaultPushState ),
			refetchSites: jest.fn(),
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
			syncSupport: 'syncable',
		};
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		( useSyncSites as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeSyncSite ],
			syncSites: [ fakeSyncSite ],
			pullSite: jest.fn(),
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn().mockReturnValue( defaultPushState ),
			refetchSites: jest.fn(),
		} );
		renderWithProvider( <ContentTabSync selectedSite={ selectedSite } /> );

		const urlButton = screen.getByRole( 'button', { name: new RegExp( fakeSyncSite.url, 'i' ) } );
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
			syncSupport: 'syncable',
		};
		const fakeStagingSite = {
			id: 7,
			name: 'Staging: My simple business site',
			url: 'https://developer-staging.wordpress.com/studio/',
			isStaging: true,
			stagingSiteIds: [],
			syncSupport: 'syncable',
		};
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );

		( useSyncSites as jest.Mock ).mockReturnValue( {
			connectedSites: [ fakeProductionSite, fakeStagingSite ],
			syncSites: [ fakeProductionSite ],
			pullSite: jest.fn(),
			isAnySitePulling: false,
			isAnySitePushing: false,
			getPullState: jest.fn(),
			getPushState: jest.fn().mockReturnValue( defaultPushState ),
			refetchSites: jest.fn(),
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
			name: 'https://developer.wordpress.com/studio/ ↗',
		} );
		expect( productionUrl ).toHaveLength( 1 );

		const stagingUrl = screen.getAllByRole( 'button', {
			name: 'https://developer-staging.wordpress.com/studio/ ↗',
		} );
		expect( stagingUrl ).toHaveLength( 1 );
	} );
} );
