// To run tests, execute `npm run test -- src/components/tests/content-tab-settings.test.tsx` from the root directory
import { UnknownAction } from '@reduxjs/toolkit';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { produce } from 'immer';
import { Provider } from 'react-redux';
import { Snapshot } from 'common/types/snapshot';
import { ContentTabSettings } from 'src/components/content-tab-settings';
import { useGetWpVersion } from 'src/hooks/use-get-wp-version';
import { useOffline } from 'src/hooks/use-offline';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState, store } from 'src/stores';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';

function snapshotTestReducer( state: RootState | undefined, action: UnknownAction ) {
	if ( action.type === 'snapshot/addSnapshot' ) {
		const payload = action.payload as {
			snapshot: Snapshot;
		};

		return produce( state!, ( draftState ) => {
			draftState.snapshot.snapshots.push( payload.snapshot );
		} );
	}

	return testReducer( state, action );
}

const snapshotTestActions = {
	addSnapshot: ( snapshot: Snapshot ) => {
		return { type: 'snapshot/addSnapshot', payload: { snapshot } };
	},
};

store.replaceReducer( snapshotTestReducer );

jest.mock( 'src/hooks/use-get-wp-version' );
jest.mock( 'src/hooks/use-site-details' );
jest.mock( 'src/lib/get-ipc-api' );
jest.mock( 'src/lib/app-globals', () => ( {
	isWindows: () => false,
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

function renderWithProvider( component: React.ReactElement ) {
	return render( <Provider store={ store }>{ component }</Provider> );
}

function rerenderWithProvider(
	rerender: ( component: React.ReactElement ) => void,
	component: React.ReactElement
) {
	rerender( <Provider store={ store }>{ component }</Provider> );
}

describe( 'ContentTabSettings', () => {
	const copyText = jest.fn();
	const openLocalPath = jest.fn();
	const generateProposedSitePath = jest.fn();
	const getAllCustomDomains = jest.fn().mockResolvedValue( [] );
	const mockSnapshot = {
		localSiteId: selectedSite.id,
		url: 'http://localhost:8881',
		date: Date.now(),
		name: 'Test Snapshot',
		sequence: 1,
		atomicSiteId: 1,
	};

	beforeEach( () => {
		jest.clearAllMocks();
		( useGetWpVersion as jest.Mock ).mockReturnValue( [ '7.7.7', jest.fn() ] );
		( getIpcApi as jest.Mock ).mockReturnValue( {
			copyText,
			openLocalPath,
			generateProposedSitePath,
			getAllCustomDomains,
			isCATrusted: jest.fn( () => Promise.resolve( true ) ),
		} );

		store.dispatch( testActions.resetState() );

		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite,
			uploadingSites: {},
			deleteSite: jest.fn(),
			isDeleting: false,
			updateSite: jest.fn(),
		} );
	} );

	test( 'renders site details correctly', () => {
		renderWithProvider( <ContentTabSettings selectedSite={ selectedSite } /> );

		expect( screen.getByRole( 'heading', { name: 'Site details' } ) ).toBeVisible();
		expect( screen.getByText( 'Test Site' ) ).toBeVisible();
		expect(
			screen.getByRole( 'button', { name: 'localhost:8881, Copy site url to clipboard' } )
		).toHaveTextContent( 'localhost:8881' );
		expect( screen.getByText( 'HTTPS' ) ).toBeVisible();
		expect( screen.getByText( 'Disabled' ) ).toBeVisible();
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
		renderWithProvider( <ContentTabSettings selectedSite={ selectedSite } /> );

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
		renderWithProvider( <ContentTabSettings selectedSite={ selectedSiteRunning } /> );

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
		renderWithProvider( <ContentTabSettings selectedSite={ selectedSite } /> );

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
		store.dispatch( snapshotTestActions.addSnapshot( mockSnapshot ) );
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite: selectedSite,
			deleteSite: jest.fn(),
			isDeleting: false,
		} );
		renderWithProvider( <ContentTabSettings selectedSite={ selectedSite } /> );
		const dropdownButton = screen.getByRole( 'button', { name: 'More options' } );
		await userEvent.click( dropdownButton );
		const deleteSiteButton = screen.getByRole( 'menuitem', { name: 'Delete site' } );
		expect( deleteSiteButton ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.mouseOver( deleteSiteButton );
		expect(
			screen.getByRole( 'tooltip', {
				name: 'This site has active preview sites that cannot be deleted without an internet connection.',
			} )
		).toBeVisible();
	} );

	describe( 'when a legacy site lacks a stored password', () => {
		test( 'allows copying the default password', async () => {
			const user = userEvent.setup();
			const { adminPassword, ...selectedSiteLegacy }: SiteDetails = selectedSite;
			renderWithProvider( <ContentTabSettings selectedSite={ selectedSiteLegacy } /> );

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

			store.dispatch( snapshotTestActions.addSnapshot( mockSnapshot ) );

			// Mock snapshots to include a snapshot for the selected site
			( useSiteDetails as jest.Mock ).mockReturnValue( {
				selectedSite: { ...selectedSite, running: false } as SiteDetails,
				updateSite,
				startServer,
				stopServer,
			} );

			const { rerender } = renderWithProvider(
				<ContentTabSettings selectedSite={ selectedSite } />
			);
			expect( screen.getByText( '8.3' ) ).toBeVisible();
			await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );
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

			await waitFor( () => {
				expect( updateSite ).toHaveBeenCalledWith(
					expect.objectContaining( { phpVersion: '8.2' } )
				);
				expect( stopServer ).not.toHaveBeenCalled();
				expect( startServer ).not.toHaveBeenCalled();
			} );

			rerenderWithProvider(
				rerender,
				<ContentTabSettings selectedSite={ { ...selectedSite, phpVersion: '8.2' } } />
			);
			await waitFor( () => {
				expect( screen.getByText( '8.2' ) ).toBeVisible();
			} );
		} );

		it( 'changes PHP version and restarts site when site is running', async () => {
			const user = userEvent.setup();

			const updateSite = jest.fn();
			const startServer = jest.fn();
			const stopServer = jest.fn();
			// Mock snapshots to include a snapshot for the selected site
			store.dispatch( snapshotTestActions.addSnapshot( mockSnapshot ) );
			( useSiteDetails as jest.Mock ).mockReturnValue( {
				selectedSite: { ...selectedSite, running: true } as SiteDetails,
				updateSite,
				startServer,
				stopServer,
			} );

			const { rerender } = renderWithProvider(
				<ContentTabSettings selectedSite={ selectedSite } />
			);
			expect( screen.getByText( '8.3' ) ).toBeVisible();
			await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );
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

			await waitFor( () => {
				expect( updateSite ).toHaveBeenCalledWith(
					expect.objectContaining( { phpVersion: '8.2' } )
				);
				expect( stopServer ).toHaveBeenCalled();
				expect( startServer ).toHaveBeenCalled();
			} );

			rerenderWithProvider(
				rerender,
				<ContentTabSettings selectedSite={ { ...selectedSite, phpVersion: '8.2' } } />
			);
			await waitFor( () => {
				expect( screen.getByText( '8.2' ) ).toBeVisible();
			} );
		} );
	} );
} );
