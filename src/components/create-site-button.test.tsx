import { jest } from '@jest/globals';
import { render, waitFor, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import CreateSiteButton from './create-site-button';

const mockShowOpenFolderDialog = jest.fn< ( dialogTitle: string ) => Promise< string | null > >();
jest.mock( '../get-ipc-api', () => ( {
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
	} ),
} ) );

describe( 'CreateSiteButton', () => {
	beforeEach( () => {
		jest.clearAllMocks(); // Clear mock call history between tests
	} );

	it( 'calls createSite with selected path when button is clicked', async () => {
		const user = userEvent.setup();

		mockShowOpenFolderDialog.mockResolvedValue( 'test' );
		render( <CreateSiteButton /> );

		await user.click( screen.getByRole( 'button', { name: 'Create site' } ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site' );
		await waitFor( () => {
			expect( mockCreateSite ).toHaveBeenCalledWith( 'test' );
		} );
	} );

	it( 'does not call createSite if no path is selected', async () => {
		const user = userEvent.setup();

		mockShowOpenFolderDialog.mockResolvedValue( null );
		const { getByRole } = render( <CreateSiteButton /> );

		await user.click( screen.getByRole( 'button', { name: 'Create site' } ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site' );
		await waitFor( () => {
			expect( mockCreateSite ).not.toHaveBeenCalled();
		} );
	} );
} );
