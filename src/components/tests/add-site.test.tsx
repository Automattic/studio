// Run tests: yarn test -- src/components/add-site-button.test.tsx
import { jest } from '@jest/globals';
import { render, waitFor, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { FolderDialogResponse } from '../../ipc-handlers';
import AddSite from '../add-site';

const mockShowOpenFolderDialog =
	jest.fn< ( dialogTitle: string ) => Promise< FolderDialogResponse | null > >();
const mockGenerateProposedSitePath =
	jest.fn< ( siteName: string ) => Promise< FolderDialogResponse > >();
jest.mock( '../../lib/get-ipc-api', () => ( {
	__esModule: true,
	default: jest.fn(),
	getIpcApi: () => ( {
		showOpenFolderDialog: mockShowOpenFolderDialog,
		generateProposedSitePath: mockGenerateProposedSitePath,
	} ),
} ) );

const mockCreateSite = jest.fn< ( path: string ) => void >();
jest.mock( '../../hooks/use-site-details', () => ( {
	useSiteDetails: () => ( {
		createSite: mockCreateSite,
		data: [],
	} ),
} ) );

describe( 'CreateSite', () => {
	beforeEach( () => {
		jest.clearAllMocks(); // Clear mock call history between tests
	} );

	it( 'calls createSite with selected path when add site button is clicked', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default_path/my-wordpress-website',
			name: 'My WordPress Website',
			isEmpty: true,
			isWordPress: false,
		} );

		mockShowOpenFolderDialog.mockResolvedValue( {
			path: 'test',
			name: 'test',
			isEmpty: true,
			isWordPress: false,
		} );
		render( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();
		await user.click( screen.getByTestId( 'select-path-button' ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site' );
		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );

		await waitFor( () => {
			expect( mockCreateSite ).toHaveBeenCalledWith( 'test', 'My WordPress Website' );
		} );
	} );

	it( 'should display an error informing the user if the selected site folder does not contain a WordPress site', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default_path/my-wordpress-website',
			name: 'My WordPress Website',
			isEmpty: true,
			isWordPress: false,
		} );
		mockShowOpenFolderDialog.mockResolvedValue( {
			path: 'test',
			name: 'test',
			isEmpty: false,
			isWordPress: false,
		} );
		render( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();
		await user.click( screen.getByTestId( 'select-path-button' ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site' );

		await waitFor( () => {
			expect( screen.getByRole( 'button', { name: 'Add site' } ) ).toBeDisabled();
			expect( screen.getByRole( 'alert' ) ).toHaveTextContent(
				'This directory is not empty. Please select an empty directory or an existing WordPress folder.'
			);
		} );
	} );

	it( 'should display a warning informing the user that the folder is not empty', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default_path/my-wordpress-website',
			name: 'My WordPress Website',
			isEmpty: true,
			isWordPress: false,
		} );

		mockShowOpenFolderDialog.mockResolvedValue( {
			path: 'test',
			name: 'test',
			isEmpty: false,
			isWordPress: true,
		} );
		render( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();
		await user.click( screen.getByTestId( 'select-path-button' ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site' );

		await waitFor( () => {
			expect( screen.getByRole( 'button', { name: 'Add site' } ) ).not.toBeDisabled();
			expect( screen.getByRole( 'alert' ) ).toHaveTextContent(
				'The existing WordPress site at this path will be added.'
			);
		} );
	} );
} );
