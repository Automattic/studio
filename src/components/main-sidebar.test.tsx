import { render, fireEvent, act, waitFor } from '@testing-library/react';
import { useAuth } from '../hooks/use-auth';
import MainSidebar from './main-sidebar';

jest.mock( '../hooks/use-auth' );
jest.mock( '../lib/app-globals' );

const mockOpenURL = jest.fn();
const mockGetAppGlobals = jest.fn();
jest.mock( '../lib/get-ipc-api', () => ( {
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
	snapshots: [],
	setSelectedSiteId: jest.fn(),
	createSite: jest.fn(),
	startServer: jest.fn(),
	stopServer: jest.fn(),
};
jest.mock( '../hooks/use-site-details', () => ( {
	useSiteDetails: () => ( { ...siteDetailsMocked } ),
} ) );

describe( 'MainSidebar Footer', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );
	it( 'Has add site button', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false } );
		const { getByRole } = await act( async () => render( <MainSidebar /> ) );
		expect( getByRole( 'button', { name: 'Add site' } ) ).toBeInTheDocument();
	} );

	it( 'Test unauthenticated footer has the Log in button', async () => {
		const authenticate = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate } );
		const { getByRole } = await act( async () => render( <MainSidebar /> ) );
		expect( getByRole( 'button', { name: 'Log in' } ) ).toBeInTheDocument();
		fireEvent.click( getByRole( 'button', { name: 'Log in' } ) );
		expect( authenticate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'Test authenticated footer does not have the log in button and it has the settings and account buttons', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		const { queryByText, getByLabelText } = await act( async () => render( <MainSidebar /> ) );
		expect( queryByText( 'Log in' ) ).not.toBeInTheDocument();
		const settingsButton = getByLabelText( 'Settings' );
		expect( settingsButton ).toBeInTheDocument();
		expect( getByLabelText( 'Account' ) ).toBeInTheDocument();
	} );

	it( 'applies className prop', async () => {
		const { container } = await act( async () =>
			render( <MainSidebar className={ 'test-class' } /> )
		);
		expect( container.firstChild ).toHaveClass( 'test-class' );
	} );
} );
describe( 'MainSidebar Site Menu', () => {
	it( 'It renders the list of sites', async () => {
		const { getByText } = await act( async () => render( <MainSidebar /> ) );
		expect( getByText( 'test-1' ) ).toBeInTheDocument();
		expect( getByText( 'test-2' ) ).toBeInTheDocument();
		expect( getByText( 'test-3' ) ).toBeInTheDocument();
	} );

	it( 'the sites are not running', async () => {
		const { getByText } = await act( async () => render( <MainSidebar /> ) );
		expect(
			getByText( 'test-1' ).parentElement?.querySelector( '[aria-label*="start site"]' )
		).toBeInTheDocument();
		expect(
			getByText( 'test-2' ).parentElement?.querySelector( '[aria-label*="start site"]' )
		).toBeInTheDocument();
	} );

	it( 'start a site', async () => {
		const { getByRole } = await act( async () => render( <MainSidebar /> ) );
		const greenDotFirstSite = getByRole( 'button', { name: 'start site test-1' } );
		expect( greenDotFirstSite ).toBeInTheDocument();
		fireEvent.click( greenDotFirstSite );
		expect( siteDetailsMocked.startServer ).toHaveBeenCalledWith(
			'0e9e237b-335a-43fa-b439-9b078a618512'
		);
	} );

	it( 'stop a site', async () => {
		const { getByRole } = await act( async () => render( <MainSidebar /> ) );
		const greenDotFirstSite = getByRole( 'button', { name: 'stop site test-3' } );
		expect( greenDotFirstSite ).toBeInTheDocument();
		fireEvent.click( greenDotFirstSite );
		expect( siteDetailsMocked.stopServer ).toHaveBeenCalledWith(
			'0e9e237b-335a-43fa-b439-9b078a613333'
		);
	} );

	it( 'opens the support URL with the correct locale', async () => {
		mockGetAppGlobals.mockResolvedValue( { locale: 'zh-cn' } );
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );

		const { getByRole } = render( <MainSidebar /> );

		const helpIconButton = getByRole( 'button', { name: 'Help' } );
		fireEvent.click( helpIconButton );
		await waitFor( () =>
			expect( mockOpenURL ).toHaveBeenCalledWith( `https://wordpress.com/zh-cn/support` )
		);
	} );
} );
