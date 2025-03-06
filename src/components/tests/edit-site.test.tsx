import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import EditSite from 'src/components/edit-site';

jest.mock( 'src/hooks/use-feature-flags', () => ( {
	useFeatureFlags: jest.fn().mockReturnValue( { wpVersionsEnabled: true } ),
} ) );

jest.mock( 'src/stores', () => {
	const mockDispatch = jest.fn();
	return {
		useAppDispatch: jest.fn().mockReturnValue( mockDispatch ),
		useRootSelector: jest.fn().mockImplementation( ( selector ) => {
			if (
				typeof selector === 'object' &&
				selector !== null &&
				'name' in selector &&
				selector.name === 'selectWordPressVersionsWithLatest'
			) {
				return [
					{ name: '6.4', version: '6.4' },
					{ name: '6.3', version: '6.3' },
				];
			}
			return { status: 'succeeded' };
		} ),
	};
} );

jest.mock( 'src/stores/wordpress-versions-slice', () => ( {
	wordpressVersionsSelectors: {
		selectWordPressVersionsWithLatest: { name: 'selectWordPressVersionsWithLatest' },
	},
	wordpressVersionsThunks: {
		fetchWordPressVersions: jest.fn(),
	},
} ) );

const mockUpdateSite = jest.fn();
jest.mock( 'src/hooks/use-site-details', () => ( {
	useSiteDetails: () => ( {
		selectedSite: {
			name: 'Test Site',
			path: '/path/to/site',
			id: 'site-id',
			wpVersion: '6.4',
			phpVersion: '8.0',
		},
		updateSite: mockUpdateSite,
		data: [],
	} ),
} ) );

describe( 'EditSite', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		render( <EditSite /> );
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
