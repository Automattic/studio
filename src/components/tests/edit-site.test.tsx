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
	it( 'should dismiss the modal when the cancel button is activated via keyboard', async () => {
		const user = userEvent.setup();
		render( <EditSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Edit site name' } ) );
		expect( screen.queryByRole( 'dialog' ) ).toBeInTheDocument();

		await userEvent.tab();
		await userEvent.keyboard( '{Enter}' );

		expect( mockUpdateSite ).not.toHaveBeenCalled();
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );
} );
