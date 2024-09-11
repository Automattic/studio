// To run tests, execute `npm run test -- src/components/tests/content-tab-settings.test.tsx` from the root directory
import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useGetWpVersion } from '../../hooks/use-get-wp-version';
import { useOffline } from '../../hooks/use-offline';
import { useSiteDetails } from '../../hooks/use-site-details';
import { useSnapshots } from '../../hooks/use-snapshots';
import { getIpcApi } from '../../lib/get-ipc-api';
import { ContentTabSettings } from '../content-tab-settings';

jest.mock( '../../hooks/use-get-wp-version' );
jest.mock( '../../hooks/use-snapshots' );
jest.mock( '../../hooks/use-site-details' );
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

describe( 'ContentTabSettings', () => {
	const copyText = jest.fn();
	const openLocalPath = jest.fn();
	const generateProposedSitePath = jest.fn();
	beforeEach( () => {
		jest.clearAllMocks();
		( useGetWpVersion as jest.Mock ).mockReturnValue( '7.7.7' );
		( getIpcApi as jest.Mock ).mockReturnValue( {
			copyText,
			openLocalPath,
			generateProposedSitePath,
		} );

		( useSnapshots as jest.Mock ).mockReturnValue( {
			snapshots: [],
		} );

		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite,
			uploadingSites: {},
			deleteSite: jest.fn(),
			isDeleting: false,
			updateSite: jest.fn(),
		} );
	} );

	test( 'renders site details correctly', () => {
		render( <ContentTabSettings selectedSite={ selectedSite } /> );

		expect( screen.getByRole( 'heading', { name: 'Site details' } ) ).toBeVisible();
		expect( screen.getByText( 'Test Site' ) ).toBeVisible();
		expect(
			screen.getByRole( 'button', { name: 'localhost:8881, Copy site url to clipboard' } )
		).toHaveTextContent( 'localhost:8881' );
		expect( screen.getByRole( 'button', { name: 'Copy local path to clipboard' } ) ).toBeVisible();
		expect( screen.getByText( '7.7.7' ) ).toBeVisible();
		expect(
			screen.getByRole( 'button', {
				name: 'localhost:8881/wp-admin, Copy wp-admin url to clipboard',
			} )
		).toHaveTextContent( 'localhost:8881/wp-admin' );
	} );

	test( 'allows copying the site path', async () => {
		const user = userEvent.setup();
		render( <ContentTabSettings selectedSite={ selectedSite } /> );

		const localPathButton = screen.getByRole( 'button', { name: 'Copy local path to clipboard' } );
		expect( localPathButton ).toBeVisible();
		await user.click( localPathButton );
		expect( copyText ).toHaveBeenCalledTimes( 1 );
		expect( copyText ).toHaveBeenCalledWith( '/path/to/site' );
	} );

	test( 'URL buttons work well when site is running', async () => {
		const user = userEvent.setup();
		const selectedSiteRunning: SiteDetails = {
			...selectedSite,
			port: 8881,
			url: 'http://localhost:8881',
			running: true,
		};
		render( <ContentTabSettings selectedSite={ selectedSiteRunning } /> );

		const urlButton = screen.getByRole( 'button', {
			name: 'localhost:8881, Copy site url to clipboard',
		} );
		expect( urlButton ).toBeVisible();
		await user.click( urlButton );
		expect( copyText ).toHaveBeenCalledTimes( 1 );
		expect( copyText ).toHaveBeenCalledWith( 'http://localhost:8881' );

		const wpAdminButton = screen.getByRole( 'button', {
			name: 'localhost:8881/wp-admin, Copy wp-admin url to clipboard',
		} );
		expect( wpAdminButton ).toBeVisible();
		await user.click( wpAdminButton );
		expect( copyText ).toHaveBeenCalledTimes( 2 );
		expect( copyText ).toHaveBeenCalledWith( 'http://localhost:8881/wp-admin' );
	} );

	test( 'allows copying the site password', async () => {
		const user = userEvent.setup();
		render( <ContentTabSettings selectedSite={ selectedSite } /> );

		const adminPasswordButton = screen.getByRole( 'button', {
			name: 'Copy admin password to clipboard',
		} );
		expect( adminPasswordButton ).toBeVisible();
		await user.click( adminPasswordButton );
		expect( copyText ).toHaveBeenCalledTimes( 1 );
		expect( copyText ).toHaveBeenCalledWith( 'test-password' );
	} );

	it( 'disables delete site button when offline and there is at least one snapshot present for the site', async () => {
		( useOffline as jest.Mock ).mockReturnValue( true );

		// Mock snapshots to include a snapshot for the selected site
		( useSnapshots as jest.Mock ).mockReturnValue( {
			snapshots: [ { localSiteId: selectedSite.id } ],
		} );
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite: selectedSite,
			deleteSite: jest.fn(),
			isDeleting: false,
		} );
		render( <ContentTabSettings selectedSite={ selectedSite } /> );
		const deleteSiteButton = await screen.findByRole( 'button', { name: 'Delete site' } );
		expect( deleteSiteButton ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.mouseOver( deleteSiteButton );
		expect(
			screen.getByRole( 'tooltip', {
				name: 'This site has active demo sites that cannot be deleted without an internet connection.',
			} )
		).toBeVisible();
	} );

	describe( 'when a legacy site lacks a stored password', () => {
		test( 'allows copying the default password', async () => {
			const user = userEvent.setup();
			const { adminPassword, ...selectedSiteLegacy }: SiteDetails = selectedSite;
			render( <ContentTabSettings selectedSite={ selectedSiteLegacy } /> );

			const adminPasswordButton = screen.getByRole( 'button', {
				name: 'Copy admin password to clipboard',
			} );
			expect( adminPasswordButton ).toBeVisible();
			await user.click( adminPasswordButton );
			expect( copyText ).toHaveBeenCalledTimes( 1 );
			expect( copyText ).toHaveBeenCalledWith( 'password' );
		} );
	} );

	describe( 'PHP version', () => {
		it( 'changes PHP version when site is not running', async () => {
			const user = userEvent.setup();

			const updateSite = jest.fn();
			const startServer = jest.fn();
			const stopServer = jest.fn();

			( useSnapshots as jest.Mock ).mockReturnValue( {
				snapshots: [ { localSiteId: selectedSite.id } ],
			} );

			// Mock snapshots to include a snapshot for the selected site
			( useSiteDetails as jest.Mock ).mockReturnValue( {
				selectedSite: { ...selectedSite, running: false } as SiteDetails,
				updateSite,
				startServer,
				stopServer,
			} );

			const { rerender } = render( <ContentTabSettings selectedSite={ selectedSite } /> );
			expect( screen.getByText( '8.0' ) ).toBeVisible();
			await user.click( screen.getByRole( 'button', { name: 'Edit PHP version' } ) );
			const dialog = screen.getByRole( 'dialog' );
			expect( dialog ).toBeVisible();
			await user.selectOptions(
				within( dialog ).getByRole( 'combobox', {
					name: 'PHP version',
				} ),
				'8.2'
			);
			await user.click(
				within( dialog ).getByRole( 'button', {
					name: 'Save',
				} )
			);
			expect( updateSite ).toHaveBeenCalledWith( expect.objectContaining( { phpVersion: '8.2' } ) );
			expect( stopServer ).not.toHaveBeenCalled();
			expect( startServer ).not.toHaveBeenCalled();

			rerender( <ContentTabSettings selectedSite={ { ...selectedSite, phpVersion: '8.2' } } /> );
			expect( screen.getByText( '8.2' ) ).toBeVisible();
		} );

		it( 'changes PHP version and restarts site when site is running', async () => {
			const user = userEvent.setup();

			const updateSite = jest.fn();
			const startServer = jest.fn();
			const stopServer = jest.fn();
			// Mock snapshots to include a snapshot for the selected site
			( useSnapshots as jest.Mock ).mockReturnValue( {
				snapshots: [ { localSiteId: selectedSite.id } ],
			} );
			( useSiteDetails as jest.Mock ).mockReturnValue( {
				selectedSite: { ...selectedSite, running: true } as SiteDetails,
				updateSite,
				startServer,
				stopServer,
			} );

			const { rerender } = render( <ContentTabSettings selectedSite={ selectedSite } /> );
			expect( screen.getByText( '8.0' ) ).toBeVisible();
			await user.click( screen.getByRole( 'button', { name: 'Edit PHP version' } ) );
			const dialog = screen.getByRole( 'dialog' );
			expect( dialog ).toBeVisible();
			await user.selectOptions(
				within( dialog ).getByRole( 'combobox', {
					name: 'PHP version',
				} ),
				'8.2'
			);
			await user.click(
				within( dialog ).getByRole( 'button', {
					name: 'Save',
				} )
			);
			expect( updateSite ).toHaveBeenCalledWith( expect.objectContaining( { phpVersion: '8.2' } ) );
			expect( stopServer ).toHaveBeenCalled();
			expect( startServer ).toHaveBeenCalled();

			rerender( <ContentTabSettings selectedSite={ { ...selectedSite, phpVersion: '8.2' } } /> );
			expect( screen.getByText( '8.2' ) ).toBeVisible();
		} );
	} );
} );
