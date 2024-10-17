// To run tests, execute `npm run test -- src/components/tests/content-tab-sync.test.tsx` from the root directory
import { render, screen, fireEvent } from '@testing-library/react';
import { useAuth } from '../../hooks/use-auth';
import { getIpcApi } from '../../lib/get-ipc-api';
import { ContentTabSync } from '../content-tab-sync';

jest.mock( '../../hooks/use-auth' );
jest.mock( '../../lib/get-ipc-api' );

const selectedSite: SiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	adminPassword: btoa( 'test-password' ),
	running: false,
	phpVersion: '8.0',
	id: 'site-id',
};

describe( 'ContentTabSync', () => {
	beforeEach( () => {
		jest.resetAllMocks();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate: jest.fn() } );
		( getIpcApi as jest.Mock ).mockReturnValue( {
			openURL: jest.fn(),
			generateProposedSitePath: jest.fn(),
			showMessageBox: jest.fn(),
		} );
	} );

	it( 'renders the sync title and login buttons', () => {
		render( <ContentTabSync selectedSite={ selectedSite } /> );
		expect( screen.getByText( 'Sync with' ) ).toBeInTheDocument();

		const loginButton = screen.getByRole( 'button', { name: 'Log in to WordPress.com ↗' } );
		expect( loginButton ).toBeInTheDocument();

		fireEvent.click( loginButton );
		expect( useAuth().authenticate ).toHaveBeenCalled();

		const freeAccountButton = screen.getByRole( 'button', { name: 'Create a free account ↗' } );
		expect( freeAccountButton ).toBeInTheDocument();

		fireEvent.click( freeAccountButton );
		expect( getIpcApi().openURL ).toHaveBeenCalled();
	} );

	it( 'displays create new site button to authenticated user', () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		render( <ContentTabSync selectedSite={ selectedSite } /> );
		const createSiteButton = screen.getByRole( 'button', { name: 'Create new site ↗' } );
		fireEvent.click( createSiteButton );

		expect( screen.getByText( 'Sync with' ) ).toBeInTheDocument();
		expect( createSiteButton ).toBeInTheDocument();
		expect( getIpcApi().openURL ).toHaveBeenCalledWith( 'https://wordpress.com/start/new-site' );
	} );

	it( 'displays connect site button to authenticated user', () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, authenticate: jest.fn() } );
		render( <ContentTabSync selectedSite={ selectedSite } /> );
		const connectSiteButton = screen.getByRole( 'button', { name: 'Connect site' } );

		expect( connectSiteButton ).toBeInTheDocument();
	} );
} );
