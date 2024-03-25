// To run tests, execute `npm run test -- src/components/content-tab-settings.test.tsx` from the root directory
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useGetWpVersion } from '../../hooks/use-get-wp-version';
import { getIpcApi } from '../../lib/get-ipc-api';
import { ContentTabSettings } from '../content-tab-settings';

jest.mock( '../../hooks/use-get-wp-version' );
jest.mock( '../../lib/get-ipc-api' );

const selectedSite: SiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	adminPassword: 'encrypted-password',
	running: false,
	id: 'site-id',
};

describe( 'ContentTabSettings', () => {
	const copyText = jest.fn();
	const openLocalPath = jest.fn();
	const generateProposedSitePath = jest.fn();
	const getDecryptedPassword = jest.fn( () => Promise.resolve( 'decrypted-password' ) );
	beforeEach( () => {
		jest.clearAllMocks();
		( useGetWpVersion as jest.Mock ).mockReturnValue( '7.7.7' );
		( getIpcApi as jest.Mock ).mockReturnValue( {
			copyText,
			openLocalPath,
			generateProposedSitePath,
			getDecryptedPassword,
		} );
	} );

	test( 'renders site details correctly', async () => {
		render( <ContentTabSettings selectedSite={ selectedSite } /> );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Copy admin password to clipboard' } )
			).not.toBeDisabled()
		);

		expect( screen.getByRole( 'heading', { name: 'Site details' } ) ).toBeInTheDocument();
		expect( screen.getByText( 'Test Site' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'localhost:8881, Copy site url to clipboard' } )
		).toHaveTextContent( 'localhost:8881' );
		expect(
			screen.getByRole( 'button', { name: '/path/to/site, Open local path' } )
		).toBeInTheDocument();
		expect( screen.getByText( '7.7.7' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', {
				name: 'localhost:8881/wp-admin, Copy wp-admin url to clipboard',
			} )
		).toHaveTextContent( 'localhost:8881/wp-admin' );
	} );

	test( 'button opens local path', async () => {
		const user = userEvent.setup();
		render( <ContentTabSettings selectedSite={ selectedSite } /> );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Copy admin password to clipboard' } )
			).not.toBeDisabled()
		);

		const pathButton = screen.getByRole( 'button', { name: '/path/to/site, Open local path' } );
		expect( pathButton ).toBeInTheDocument();
		await user.click( pathButton );
		expect( openLocalPath ).toHaveBeenCalledWith( '/path/to/site' );
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
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Copy admin password to clipboard' } )
			).not.toBeDisabled()
		);

		const urlButton = screen.getByRole( 'button', {
			name: 'localhost:8881, Copy site url to clipboard',
		} );
		expect( urlButton ).toBeInTheDocument();
		await user.click( urlButton );
		expect( copyText ).toHaveBeenCalledTimes( 1 );
		expect( copyText ).toHaveBeenCalledWith( 'http://localhost:8881' );

		const wpAdminButton = screen.getByRole( 'button', {
			name: 'localhost:8881/wp-admin, Copy wp-admin url to clipboard',
		} );
		expect( wpAdminButton ).toBeInTheDocument();
		await user.click( wpAdminButton );
		expect( copyText ).toHaveBeenCalledTimes( 2 );
		expect( copyText ).toHaveBeenCalledWith( 'http://localhost:8881/wp-admin' );
	} );

	test( 'allows copying the site password', async () => {
		const user = userEvent.setup();
		render( <ContentTabSettings selectedSite={ selectedSite } /> );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Copy admin password to clipboard' } )
			).not.toBeDisabled()
		);

		const adminPasswordButton = screen.getByRole( 'button', {
			name: 'Copy admin password to clipboard',
		} );
		expect( adminPasswordButton ).toBeInTheDocument();
		await user.click( adminPasswordButton );
		expect( copyText ).toHaveBeenCalledTimes( 1 );
		expect( copyText ).toHaveBeenCalledWith( 'decrypted-password' );
	} );

	describe( 'when a legacy site lacks a stored password', () => {
		beforeEach( () => {
			getDecryptedPassword.mockResolvedValueOnce( Promise.resolve( 'password' ) );
		} );

		test( 'allows copying the default password', async () => {
			const user = userEvent.setup();
			const { adminPassword, ...selectedSiteLegacy }: SiteDetails = selectedSite;
			render( <ContentTabSettings selectedSite={ selectedSiteLegacy } /> );
			await waitFor( () =>
				expect(
					screen.getByRole( 'button', { name: 'Copy admin password to clipboard' } )
				).not.toBeDisabled()
			);

			const adminPasswordButton = screen.getByRole( 'button', {
				name: 'Copy admin password to clipboard',
			} );
			expect( adminPasswordButton ).toBeInTheDocument();
			await user.click( adminPasswordButton );
			expect( copyText ).toHaveBeenCalledTimes( 1 );
			expect( copyText ).toHaveBeenCalledWith( 'password' );
		} );
	} );
} );
