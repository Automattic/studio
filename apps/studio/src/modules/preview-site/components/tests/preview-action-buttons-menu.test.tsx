import { UnknownAction } from '@reduxjs/toolkit';
import { Snapshot } from '@studio/common/types/snapshot';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { produce } from 'immer';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { PreviewActionButtonsMenu } from 'src/modules/preview-site/components/preview-action-buttons-menu';
import { store, RootState } from 'src/stores';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		setSnapshot: vi.fn( () => Promise.resolve() ),
	} ),
} ) );

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

function renderWithProvider( component: React.ReactElement ) {
	return render( <Provider store={ store }>{ component }</Provider> );
}

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
		phpVersion: '8.4',
		port: 9999,
		running: false,
	};

	beforeEach( () => {
		vi.clearAllMocks();

		// Reset Redux store state
		store.dispatch( testActions.resetState() );
	} );

	it( 'opens rename modal when rename menu item is clicked', async () => {
		const user = userEvent.setup();
		renderWithProvider(
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
		renderWithProvider(
			<PreviewActionButtonsMenu snapshot={ mockSnapshot } selectedSite={ mockSelectedSite } />
		);

		await user.click( screen.getByLabelText( 'Preview actions' ) );
		await user.click( screen.getByText( 'Rename' ) );
		await user.click( screen.getByText( 'Save' ) );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();
	} );

	it( 'updates snapshot with new name when rename is confirmed', async () => {
		store.dispatch( snapshotTestActions.addSnapshot( mockSnapshot ) );
		expect( store.getState().snapshot.snapshots[ 0 ].name ).toBe( 'Test Preview' );

		const user = userEvent.setup();
		renderWithProvider(
			<PreviewActionButtonsMenu snapshot={ mockSnapshot } selectedSite={ mockSelectedSite } />
		);
		await user.click( screen.getByLabelText( 'Preview actions' ) );
		await user.click( screen.getByText( 'Rename' ) );
		expect( screen.getByRole( 'textbox', { name: 'Name' } ) ).toHaveValue( 'Test Preview' );

		await user.clear( screen.getByRole( 'textbox', { name: 'Name' } ) );
		await user.type( screen.getByRole( 'textbox', { name: 'Name' } ), 'New Cool Name' );
		await user.click( screen.getByText( 'Save' ) );

		const state = store.getState();
		expect( state.snapshot.snapshots[ 0 ] ).toEqual( {
			...mockSnapshot,
			name: 'New Cool Name',
		} );
	} );

	it( 'closes rename modal without dispatching when cancelled', async () => {
		const user = userEvent.setup();
		renderWithProvider(
			<PreviewActionButtonsMenu snapshot={ mockSnapshot } selectedSite={ mockSelectedSite } />
		);

		await user.click( screen.getByLabelText( 'Preview actions' ) );
		await user.click( screen.getByText( 'Rename' ) );
		await user.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		expect(
			screen.queryByRole( 'heading', { name: 'Rename preview link' } )
		).not.toBeInTheDocument();
	} );

	it( 'closes rename modal without dispatching when closed', async () => {
		const user = userEvent.setup();
		renderWithProvider(
			<PreviewActionButtonsMenu snapshot={ mockSnapshot } selectedSite={ mockSelectedSite } />
		);

		await user.click( screen.getByLabelText( 'Preview actions' ) );
		await user.click( screen.getByText( 'Rename' ) );
		expect( screen.getByRole( 'button', { name: 'Close' } ) ).toBeInTheDocument();

		await user.click( screen.getByRole( 'button', { name: 'Close' } ) );

		// Wait for the modal to be fully closed after the exit animation
		await waitFor( () => {
			expect(
				screen.queryByRole( 'heading', { name: 'Rename preview link' } )
			).not.toBeInTheDocument();
		} );
	} );
} );
