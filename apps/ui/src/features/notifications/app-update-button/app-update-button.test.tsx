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
	it.each< AppUpdateStatus >( [
		{ state: 'idle', currentVersion: '2.0.0' },
		{ state: 'checking', currentVersion: '2.0.0' },
		{ state: 'downloading', currentVersion: '2.0.0', newVersion: '2.1.0' },
		{ state: 'error', currentVersion: '2.0.0', reason: 'generic' },
	] )( 'stays hidden while the updater is $state', async ( status ) => {
		const { connector, queryClient } = setup( status );
		await waitFor( () => expect( connector.getAppUpdateStatus ).toHaveBeenCalled() );
		await waitFor( () =>
			expect( queryClient.getQueryState( [ 'app-update-status' ] )?.status ).toBe( 'success' )
		);
		expect( screen.queryByRole( 'button', { name: 'Update available' } ) ).not.toBeInTheDocument();
	} );

	it( 'appears when a download finishes and installs directly on click', async () => {
		const { user, connector } = setup( { state: 'idle', currentVersion: '2.0.0' } );
		await waitFor( () => expect( connector.getAppUpdateStatus ).toHaveBeenCalled() );
		await act( () => connector.emit( 'onAppUpdateStatusChanged', ready ) );
		const trigger = await screen.findByRole( 'button', { name: 'Update available' } );
		await user.hover( trigger );
		expect( await screen.findByText( 'Update available' ) ).toBeVisible();
		expect( connector.installAppUpdate ).not.toHaveBeenCalled();
		await user.click( trigger );
		await waitFor( () => expect( connector.installAppUpdate ).toHaveBeenCalledOnce() );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	it( 'offers a restart without version metadata and allows retry after failure', async () => {
		const { user, connector } = setup( { ...ready, newVersion: null } );
		connector.installAppUpdate.mockRejectedValueOnce( new Error( 'Restart failed' ) );
		await user.click( await screen.findByRole( 'button', { name: 'Update available' } ) );
		expect( await screen.findByText( 'Couldn’t update Studio' ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Update available' } ) );
		await waitFor( () => expect( connector.installAppUpdate ).toHaveBeenCalledTimes( 2 ) );
	} );
} );
