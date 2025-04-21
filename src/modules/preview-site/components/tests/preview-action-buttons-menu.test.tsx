import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSnapshots } from 'src/hooks/use-snapshots';
import { PreviewActionButtonsMenu } from '../preview-action-buttons-menu';

jest.mock( 'src/hooks/use-snapshots', () => ( {
	useSnapshots: jest.fn().mockReturnValue( {
		deleteSnapshot: jest.fn(),
		updateSnapshot: jest.fn(),
	} ),
} ) );

describe( 'PreviewActionButtonsMenu Rename', () => {
	const mockSnapshot = {
		atomicSiteId: 123,
		localSiteId: '456',
		url: 'test.com',
		date: 123456789,
		name: 'Test Preview',
		sequence: 1,
	};

	const mockSelectedSite: StoppedSiteDetails = {
		id: '456',
		name: 'Test Site',
		path: '/test/path',
		phpVersion: '8.0',
		port: 9999,
		running: false,
	};
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'opens rename modal when rename menu item is clicked', async () => {
		const user = userEvent.setup();
		render(
			<PreviewActionButtonsMenu snapshot={ mockSnapshot } selectedSite={ mockSelectedSite } />
		);

		await user.click( screen.getByLabelText( 'Preview actions' ) );
		await user.click( screen.getByText( 'Rename' ) );

		expect( screen.getByRole( 'heading', { name: 'Rename preview link' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'textbox', { name: 'Name' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Cancel' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Close' } ) ).toBeInTheDocument();
	} );

	it( 'clicks update without modifying the existing name', async () => {
		const user = userEvent.setup();
		render(
			<PreviewActionButtonsMenu snapshot={ mockSnapshot } selectedSite={ mockSelectedSite } />
		);

		await user.click( screen.getByLabelText( 'Preview actions' ) );
		await user.click( screen.getByText( 'Rename' ) );
		await user.click( screen.getByText( 'Save' ) );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();
		expect( useSnapshots().updateSnapshot ).not.toHaveBeenCalled();
	} );

	it( 'calls updateSnapshot with new name when rename is confirmed', async () => {
		const user = userEvent.setup();
		render(
			<PreviewActionButtonsMenu snapshot={ mockSnapshot } selectedSite={ mockSelectedSite } />
		);
		await user.click( screen.getByLabelText( 'Preview actions' ) );
		await user.click( screen.getByText( 'Rename' ) );
		await user.clear( screen.getByRole( 'textbox', { name: 'Name' } ) );
		await user.type( screen.getByRole( 'textbox', { name: 'Name' } ), 'New Cool Name' );
		await user.click( screen.getByText( 'Save' ) );

		expect( useSnapshots().updateSnapshot ).toHaveBeenCalledWith( {
			...mockSnapshot,
			name: 'New Cool Name',
		} );
	} );

	it( 'closes rename modal without updating when cancelled', async () => {
		const user = userEvent.setup();
		render(
			<PreviewActionButtonsMenu snapshot={ mockSnapshot } selectedSite={ mockSelectedSite } />
		);

		await user.click( screen.getByLabelText( 'Preview actions' ) );
		await user.click( screen.getByText( 'Rename' ) );
		await user.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		expect(
			screen.queryByRole( 'heading', { name: 'Rename preview link' } )
		).not.toBeInTheDocument();
		expect( useSnapshots().updateSnapshot ).not.toHaveBeenCalled();
	} );

	it( 'closes rename modal without updating when closed', async () => {
		const user = userEvent.setup();
		render(
			<PreviewActionButtonsMenu snapshot={ mockSnapshot } selectedSite={ mockSelectedSite } />
		);

		await user.click( screen.getByLabelText( 'Preview actions' ) );
		await user.click( screen.getByText( 'Rename' ) );
		expect( screen.getByRole( 'button', { name: 'Close' } ) ).toBeInTheDocument();

		await user.click( screen.getByRole( 'button', { name: 'Close' } ) );

		expect( useSnapshots().updateSnapshot ).not.toHaveBeenCalled();

		// Wait for the modal to be fully closed after the exit animation
		await waitFor( () => {
			expect(
				screen.queryByRole( 'heading', { name: 'Rename preview link' } )
			).not.toBeInTheDocument();
		} );

		expect( useSnapshots().updateSnapshot ).not.toHaveBeenCalled();
	} );
} );
