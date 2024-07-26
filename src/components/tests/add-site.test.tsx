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
jest.mock( '../../hooks/use-feature-flags', () => ( {
	useFeatureFlags: () => ( {
		importExportEnabled: true,
	} ),
} ) );

describe( 'AddSite', () => {
	beforeEach( () => {
		jest.clearAllMocks(); // Clear mock call history between tests
	} );

	it( 'should dismiss the modal when the cancel button is activated via keyboard', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default_path/my-wordpress-website',
			name: 'My WordPress Website',
			isEmpty: true,
			isWordPress: false,
		} );
		render( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await userEvent.tab();
		await userEvent.keyboard( '{Enter}' );

		expect( mockCreateSite ).not.toHaveBeenCalled();
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
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
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		await user.click( screen.getByTestId( 'select-path-button' ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site' );
		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );

		//Expect the createSite function to be called with the selected path and no import file
		await waitFor( () => {
			expect( mockCreateSite ).toHaveBeenCalledWith( 'test', 'My WordPress Website', false );
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
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
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
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		await user.click( screen.getByTestId( 'select-path-button' ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site' );

		await waitFor( () => {
			expect( screen.getByRole( 'button', { name: 'Add site' } ) ).not.toBeDisabled();
			expect( screen.getByRole( 'alert' ) ).toHaveTextContent(
				'The existing WordPress site at this path will be added.'
			);
		} );
	} );

	it( 'should discard prior mutations and generate a new proposed site path everytime the modal is opened', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockImplementation( ( name ) => {
			const path = `/default_path/${ name.replace( /\s/g, '-' ).toLowerCase() }`;
			return Promise.resolve( {
				path,
				name,
				isEmpty: true,
				isWordPress: false,
			} );
		} );
		render( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByDisplayValue( 'My WordPress Website' ) );
		await user.type( screen.getByDisplayValue( 'My WordPress Website' ), ' mutated' );

		expect( screen.getByDisplayValue( 'My WordPress Website mutated' ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		expect(
			screen.getByDisplayValue( '/default_path/my-wordpress-website-mutated' )
		).toBeVisible();

		await userEvent.keyboard( '{Escape}' );
		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );

		expect( screen.getByDisplayValue( 'My WordPress Website' ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		expect( screen.getByDisplayValue( '/default_path/my-wordpress-website' ) ).toBeVisible();
	} );

	it( 'should reset to the proposed path when the path is set to default app directory', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockImplementation( ( name ) => {
			const path = `/default_path/${ name.replace( /\s/g, '-' ).toLowerCase() }`;
			return Promise.resolve( {
				path,
				name,
				isEmpty: true,
				isWordPress: false,
			} );
		} );
		mockShowOpenFolderDialog.mockResolvedValue( {
			path: 'populated-non-wordpress-directory',
			name: 'My WordPress Website',
			isEmpty: false,
			isWordPress: false,
		} );
		render( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		await user.click( screen.getByTestId( 'select-path-button' ) );

		mockShowOpenFolderDialog.mockResolvedValue( {
			path: '/default_path',
			name: 'My WordPress Website',
			isEmpty: false,
			isWordPress: false,
		} );
		await user.click( screen.getByTestId( 'select-path-button' ) );
		await user.click( screen.getByDisplayValue( 'My WordPress Website' ) );
		await user.type( screen.getByDisplayValue( 'My WordPress Website' ), ' mutated' );
		// screen.debug( screen.getByRole( 'dialog' ) );

		expect(
			screen.getByDisplayValue( '/default_path/my-wordpress-website-mutated' )
		).toBeVisible();
	} );
} );
