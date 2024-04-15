import { fireEvent, render, act, waitFor, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useAuth } from '../../hooks/use-auth';
import { useOffline } from '../../hooks/use-offline';
import MainSidebar from '../main-sidebar';

jest.mock( '../../hooks/use-auth' );
jest.mock( '../../lib/app-globals' );

const mockOpenURL = jest.fn();
const mockGetAppGlobals = jest.fn();
jest.mock( '../../lib/get-ipc-api', () => ( {
	__esModule: true,
	default: jest.fn(),
	getIpcApi: () => ( {
		showOpenFolderDialog: jest.fn(),
		generateProposedSitePath: jest.fn(),
		getAppGlobals: mockGetAppGlobals,
		openURL: mockOpenURL,
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
	data: [
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
	setSelectedSiteId: jest.fn(),
	createSite: jest.fn(),
	startServer: jest.fn(),
	stopServer: jest.fn(),
};
jest.mock( '../../hooks/use-site-details', () => ( {
	useSiteDetails: () => ( { ...siteDetailsMocked } ),
} ) );

describe( 'MainSidebar Footer', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );
	it( 'Has add site button', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false } );
		await act( async () => render( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'Add site' } ) ).toBeInTheDocument();
	} );

	it( 'Test unauthenticated footer has the Log in button', async () => {
		const user = userEvent.setup();
		const authenticate = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate } );
		await act( async () => render( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'Log in' } ) ).toBeInTheDocument();
		await user.click( screen.getByRole( 'button', { name: 'Log in' } ) );
		expect( authenticate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'Test authenticated footer does not have the log in button and it has the settings and account buttons', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		await act( async () => render( <MainSidebar /> ) );
		expect( screen.queryByRole( 'button', { name: 'Log in' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Account' } ) ).toBeInTheDocument();
	} );

	it( 'applies className prop', async () => {
		const { container } = await act( async () =>
			render( <MainSidebar className={ 'test-class' } /> )
		);
		expect( container.firstChild ).toHaveClass( 'test-class' );
	} );

	it( 'shows a "Stop All" button when there are running sites', async () => {
		await act( async () => render( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'Stop all' } ) ).toBeInTheDocument();
	} );

	it( 'disables log in button when offline', async () => {
		( useOffline as jest.Mock ).mockReturnValue( true );
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false } );
		await act( async () => render( <MainSidebar /> ) );
		const loginButton = screen.getByRole( 'button', { name: 'Log in' } );
		expect( loginButton ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.mouseOver( loginButton );
		expect( screen.getByRole( 'tooltip', { name: 'You’re currently offline.' } ) ).toBeVisible();
	} );

	it( 'shows offline indicator', async () => {
		( useOffline as jest.Mock ).mockReturnValue( true );
		await act( async () => render( <MainSidebar /> ) );
		const offlineIndicator = screen.getByRole( 'button', {
			name: 'Offline indicator',
		} );
		fireEvent.mouseOver( offlineIndicator );
		expect(
			screen.getByRole( 'tooltip', {
				name: 'You’re currently offline. Some features will be unavailable.',
			} )
		).toBeVisible();
	} );
} );

describe( 'MainSidebar Site Menu', () => {
	it( 'renders the list of sites', async () => {
		await act( async () => render( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'test-1' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'test-2' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'test-3' } ) ).toBeInTheDocument();
	} );

	it( 'has "start site" buttons when sites are not running', async () => {
		await act( async () => render( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'start test-1 site' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'start test-2 site' } ) ).toBeInTheDocument();
	} );

	it( 'starts a site', async () => {
		const user = userEvent.setup();
		await act( async () => render( <MainSidebar /> ) );
		const greenDotFirstSite = screen.getByRole( 'button', { name: 'start test-1 site' } );
		expect( greenDotFirstSite ).toBeInTheDocument();
		await user.click( greenDotFirstSite );
		expect( siteDetailsMocked.startServer ).toHaveBeenCalledWith(
			'0e9e237b-335a-43fa-b439-9b078a618512'
		);
	} );

	it( 'stops a site', async () => {
		const user = userEvent.setup();
		await act( async () => render( <MainSidebar /> ) );
		const greenDotFirstSite = screen.getByRole( 'button', { name: 'stop test-3 site' } );
		expect( greenDotFirstSite ).toBeInTheDocument();
		await user.click( greenDotFirstSite );
		expect( siteDetailsMocked.stopServer ).toHaveBeenCalledWith(
			'0e9e237b-335a-43fa-b439-9b078a613333'
		);
	} );

	it( 'opens the support URL with the correct locale', async () => {
		const user = userEvent.setup();
		mockGetAppGlobals.mockResolvedValue( { locale: 'zh-cn' } );
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );

		render( <MainSidebar /> );

		const helpIconButton = screen.getByRole( 'button', { name: 'Help' } );
		await user.click( helpIconButton );
		await waitFor( () =>
			expect( mockOpenURL ).toHaveBeenCalledWith( `https://wordpress.com/zh-cn/support` )
		);
	} );
} );
