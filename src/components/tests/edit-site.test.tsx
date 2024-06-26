import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import EditSite from '../edit-site';

const mockUpdateSite = jest.fn();
jest.mock( '../../hooks/use-site-details', () => ( {
	useSiteDetails: () => ( {
		selectedSite: { name: 'Test Site', path: '/path/to/site', id: 'site-id' },
		updateSite: mockUpdateSite,
		data: [],
	} ),
} ) );

describe( 'EditSite', () => {
	beforeEach( () => {
		render( <EditSite /> );
		jest.clearAllMocks();
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should dismiss the modal when the cancel button is activated via keyboard', async () => {
		const user = userEvent.setup();
		await user.click( screen.getByRole( 'button', { name: 'Edit site name' } ) );
		expect( screen.queryByRole( 'dialog' ) ).toBeVisible();

		await userEvent.tab();
		await userEvent.keyboard( '{Enter}' );

		expect( mockUpdateSite ).not.toHaveBeenCalled();
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	it( "should enable modal's save button after changing site name", async () => {
		const user = userEvent.setup();
		await user.click( screen.getByRole( 'button', { name: 'Edit site name' } ) );

		const siteNameInput = screen.getByLabelText( 'Site name' );
		await user.clear( siteNameInput );
		await user.type( siteNameInput, 'New Test Site' );

		const saveButton = screen.getByRole( 'button', { name: 'Save' } );
		expect( saveButton ).toBeEnabled();
	} );

	it( "should disable modal's save button if site name field is empty", async () => {
		const user = userEvent.setup();
		await user.click( screen.getByRole( 'button', { name: 'Edit site name' } ) );

		const siteNameInput = screen.getByLabelText( 'Site name' );
		await user.clear( siteNameInput );

		const saveButton = screen.getByRole( 'button', { name: 'Save' } );
		expect( saveButton ).toBeDisabled();
	} );
} );
