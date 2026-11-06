import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppUpdateButton, AppToasts } from '@/features/notifications';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import type { AppUpdateStatus } from '@/data/core';

const ready: AppUpdateStatus = {
	state: 'ready',
	currentVersion: '2.0.0',
	newVersion: '2.1.0',
};

function setup( status: AppUpdateStatus ) {
	const connector = createFakeConnector( {}, { getAppUpdateStatus: async () => status } );
	return renderWithProviders(
		<>
			<AppUpdateButton />
			<AppToasts />
		</>,
		{ connector }
	);
}

describe( 'AppUpdateButton', () => {
	it.each< AppUpdateStatus >( [ { state: 'idle', currentVersion: '2.0.0' } ] )(
		'stays hidden while the updater is $state',
		async ( status ) => {
			const { connector, queryClient } = setup( status );
			await waitFor( () => expect( connector.getAppUpdateStatus ).toHaveBeenCalled() );
			await waitFor( () =>
				expect( queryClient.getQueryState( [ 'app-update-status' ] )?.status ).toBe( 'success' )
			);
			expect(
				screen.queryByRole( 'button', { name: 'Update available' } )
			).not.toBeInTheDocument();
		}
	);

	it( 'keeps retry available after dismissing an error and follows the next download', async () => {
		const { user, connector } = setup( {
			state: 'error',
			currentVersion: '2.0.0',
			reason: 'generic',
		} );
		await screen.findByText( 'Couldn’t update Studio' );
		await user.click( screen.getByRole( 'button', { name: 'Dismiss Couldn’t update Studio' } ) );
		await waitFor( () =>
			expect( screen.queryByText( 'Couldn’t update Studio' ) ).not.toBeInTheDocument()
		);
		connector.checkForAppUpdates.mockImplementation( async () => {
			connector.emit( 'onAppUpdateStatusChanged', { state: 'checking', currentVersion: '2.0.0' } );
		} );
		await user.click( screen.getByRole( 'button', { name: 'Download update' } ) );
		expect( connector.checkForAppUpdates ).toHaveBeenCalledOnce();
		expect( connector.installAppUpdate ).not.toHaveBeenCalled();
		expect(
			await screen.findByRole( 'button', { name: 'Checking for updates…' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
		await act( () =>
			connector.emit( 'onAppUpdateStatusChanged', { ...ready, state: 'downloading' } )
		);
		const downloading = await screen.findByRole( 'button', { name: 'Downloading update…' } );
		expect( downloading ).toHaveAttribute( 'aria-disabled', 'true' );
		await user.click( downloading );
		expect( connector.checkForAppUpdates ).toHaveBeenCalledOnce();
		expect( connector.installAppUpdate ).not.toHaveBeenCalled();
		await act( () => connector.emit( 'onAppUpdateStatusChanged', ready ) );
		expect( await screen.findByRole( 'button', { name: 'Restart to update' } ) ).toBeEnabled();
	} );

	it( 'offers another retry when a new download fails', async () => {
		const { user, connector } = setup( {
			state: 'error',
			currentVersion: '2.0.0',
			reason: 'generic',
		} );
		await screen.findByText( 'Couldn’t update Studio' );
		await user.click( screen.getByRole( 'button', { name: 'Dismiss Couldn’t update Studio' } ) );
		await waitFor( () =>
			expect( screen.queryByText( 'Couldn’t update Studio' ) ).not.toBeInTheDocument()
		);
		await user.click( screen.getByRole( 'button', { name: 'Download update' } ) );
		await act( () =>
			connector.emit( 'onAppUpdateStatusChanged', { ...ready, state: 'downloading' } )
		);
		await act( () =>
			connector.emit( 'onAppUpdateStatusChanged', {
				state: 'error',
				currentVersion: '2.0.0',
				reason: 'generic',
			} )
		);
		expect( await screen.findByText( 'Couldn’t update Studio' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Download update' } ) ).toBeEnabled();
		expect( screen.getByRole( 'button', { name: 'Try again' } ) ).toBeVisible();
	} );

	it( 'keeps retry available when starting a new check fails', async () => {
		const { user, connector } = setup( {
			state: 'error',
			currentVersion: '2.0.0',
			reason: 'generic',
		} );
		connector.checkForAppUpdates.mockRejectedValueOnce(
			new Error( 'Could not start the update check.' )
		);
		await user.click( await screen.findByRole( 'button', { name: 'Download update' } ) );
		expect( await screen.findByText( 'Could not start the update check.' ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Download update' } ) );
		expect( connector.checkForAppUpdates ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'appears when a download finishes and installs directly on click', async () => {
		const { user, connector } = setup( { state: 'idle', currentVersion: '2.0.0' } );
		await waitFor( () => expect( connector.getAppUpdateStatus ).toHaveBeenCalled() );
		await act( () => connector.emit( 'onAppUpdateStatusChanged', ready ) );
		const trigger = await screen.findByRole( 'button', { name: 'Restart to update' } );
		await user.hover( trigger );
		expect( await screen.findByText( 'Restart to update' ) ).toBeVisible();
		expect( connector.installAppUpdate ).not.toHaveBeenCalled();
		await user.click( trigger );
		await waitFor( () => expect( connector.installAppUpdate ).toHaveBeenCalledOnce() );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	it( 'offers a restart without version metadata and allows retry after failure', async () => {
		const { user, connector } = setup( { ...ready, newVersion: null } );
		connector.installAppUpdate.mockRejectedValueOnce( new Error( 'Restart failed' ) );
		await user.click( await screen.findByRole( 'button', { name: 'Restart to update' } ) );
		expect( await screen.findByText( 'Couldn’t update Studio' ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Restart to update' } ) );
		await waitFor( () => expect( connector.installAppUpdate ).toHaveBeenCalledTimes( 2 ) );
	} );
} );

it( 'keeps an explicitly requested check visible and reports its latest-version answer once', async () => {
	const { user, connector } = setup( {
		state: 'error',
		currentVersion: '2.0.0',
		reason: 'generic',
	} );
	connector.checkForAppUpdates.mockImplementation( async () => {
		connector.emit( 'onAppUpdateStatusChanged', { state: 'checking', currentVersion: '2.0.0' } );
	} );
	await user.click( await screen.findByRole( 'button', { name: 'Try again' } ) );
	expect( await screen.findByText( 'Checking for updates…' ) ).toBeVisible();
	await act( () => connector.emit( 'onAppUpdateNotAvailable', { currentVersion: '2.0.0' } ) );
	expect( await screen.findByText( "You're on the latest version (2.0.0)" ) ).toBeVisible();
} );
