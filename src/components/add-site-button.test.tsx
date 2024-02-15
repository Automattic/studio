// Run tests: yarn test -- src/components/add-site-button.test.tsx
import { jest } from '@jest/globals';
import { render, waitFor, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { FolderDialogResponse } from '../ipc-handlers';
import CreateSiteButton from './add-site-button';

const mockShowOpenFolderDialog =
	jest.fn< ( dialogTitle: string ) => Promise< FolderDialogResponse | null > >();
jest.mock( '../lib/get-ipc-api', () => ( {
	__esModule: true,
	default: jest.fn(),
	getIpcApi: () => ( {
		showOpenFolderDialog: mockShowOpenFolderDialog,
	} ),
} ) );

const mockCreateSite = jest.fn< ( path: string ) => void >();
jest.mock( '../hooks/use-site-details', () => ( {
	useSiteDetails: () => ( {
		createSite: mockCreateSite,
		data: [],
	} ),
} ) );

describe( 'CreateSiteButton', () => {
	beforeEach( () => {
		jest.clearAllMocks(); // Clear mock call history between tests
	} );

	it( 'calls createSite with selected path when add site button is clicked', async () => {
		const user = userEvent.setup();

		mockShowOpenFolderDialog.mockResolvedValue( {
			path: 'test',
			name: 'test',
			isEmpty: true,
			isWordPress: false,
		} );
		render( <CreateSiteButton /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();
		await user.click( screen.getByTestId( 'select-path-button' ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site' );
		await user.click( screen.getByTestId( 'add-site-button' ) );

		await waitFor( () => {
			expect( mockCreateSite ).toHaveBeenCalledWith( 'test', 'test' );
		} );
	} );

	it( 'cannot not call createSite if no path is selected', async () => {
		const user = userEvent.setup();

		mockShowOpenFolderDialog.mockResolvedValue( null );
		render( <CreateSiteButton /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();
		await user.click( screen.getByTestId( 'select-path-button' ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site' );

		await waitFor( () => {
			expect( screen.getByTestId( 'add-site-button' ) ).toBeDisabled();
			expect( mockCreateSite ).not.toHaveBeenCalled();
		} );
	} );

	it( 'should display an error informing the user if the site does not contain a WordPress site', async () => {
		const user = userEvent.setup();

		mockShowOpenFolderDialog.mockResolvedValue( {
			path: 'test',
			name: 'test',
			isEmpty: false,
			isWordPress: false,
		} );
		render( <CreateSiteButton /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();
		await user.click( screen.getByTestId( 'select-path-button' ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site' );

		await waitFor( () => {
			expect( screen.getByTestId( 'add-site-button' ) ).toBeDisabled();
			expect( screen.getByText( 'This path does not contain a WordPress site.' ) ).toBeVisible();
		} );
	} );

	it( 'should display a warning informing the user that the folder is not empty', async () => {
		const user = userEvent.setup();

		mockShowOpenFolderDialog.mockResolvedValue( {
			path: 'test',
			name: 'test',
			isEmpty: false,
			isWordPress: true,
		} );
		render( <CreateSiteButton /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();
		await user.click( screen.getByTestId( 'select-path-button' ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site' );

		await waitFor( () => {
			expect( screen.getByTestId( 'add-site-button' ) ).not.toBeDisabled();
			expect(
				screen.getByText( 'The existing WordPress site at this path will be added.' )
			).toBeVisible();
		} );
	} );
} );
