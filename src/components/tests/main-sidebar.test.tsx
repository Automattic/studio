import { render, act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useAuth } from '../../hooks/use-auth';
import MainSidebar from '../main-sidebar';

jest.mock( '../../hooks/use-auth' );

const mockOpenURL = jest.fn();
jest.mock( '../../lib/get-ipc-api', () => ( {
	__esModule: true,
	default: jest.fn(),
	getIpcApi: () => ( {
		showOpenFolderDialog: jest.fn(),
		generateProposedSitePath: jest.fn(),
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
		expect( screen.getByRole( 'button', { name: 'Add site' } ) ).toBeVisible();
	} );

	it( 'applies className prop', async () => {
		const { container } = await act( async () =>
			render( <MainSidebar className={ 'test-class' } /> )
		);
		expect( container.firstChild ).toHaveClass( 'test-class' );
	} );

	it( 'shows a "Stop All" button when there are running sites', async () => {
		await act( async () => render( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'Stop all' } ) ).toBeVisible();
	} );
} );

describe( 'MainSidebar Site Menu', () => {
	it( 'renders the list of sites', async () => {
		await act( async () => render( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'test-1' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'test-2' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'test-3' } ) ).toBeVisible();
	} );

	it( 'has "start site" buttons when sites are not running', async () => {
		await act( async () => render( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'start test-1 site' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'start test-2 site' } ) ).toBeVisible();
	} );

	it( 'starts a site', async () => {
		const user = userEvent.setup();
		await act( async () => render( <MainSidebar /> ) );
		const greenDotFirstSite = screen.getByRole( 'button', { name: 'start test-1 site' } );
		expect( greenDotFirstSite ).toBeVisible();
		await user.click( greenDotFirstSite );
		expect( siteDetailsMocked.startServer ).toHaveBeenCalledWith(
			'0e9e237b-335a-43fa-b439-9b078a618512'
		);
	} );

	it( 'stops a site', async () => {
		const user = userEvent.setup();
		await act( async () => render( <MainSidebar /> ) );
		const greenDotFirstSite = screen.getByRole( 'button', { name: 'stop test-3 site' } );
		expect( greenDotFirstSite ).toBeVisible();
		await user.click( greenDotFirstSite );
		expect( siteDetailsMocked.stopServer ).toHaveBeenCalledWith(
			'0e9e237b-335a-43fa-b439-9b078a613333'
		);
	} );
} );
