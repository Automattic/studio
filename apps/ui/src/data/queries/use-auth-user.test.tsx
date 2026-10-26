import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getNoticeHistory } from '@/data/app-messages';
import { ConnectorProvider } from '@/data/core';
import { markPreviewReady, usePreviewReady } from '@/data/preview-ready';
import { createFakeConnector, TEST_USER, type FakeConnector } from '@/test/fake-connector';
import { createTestQueryClient } from '@/test/render';
import { useAuthChangeToasts, useAuthUser, useSyncAuthUserWithEvents } from './use-auth-user';
import type { AuthUser } from '@/data/core';

function renderAuthUser( connector: FakeConnector ) {
	function Probe() {
		const { data } = useAuthUser();
		useSyncAuthUserWithEvents();
		useAuthChangeToasts();
		const previewReady = usePreviewReady( 'site' );
		return (
			<span data-testid="state" data-preview-ready={ previewReady }>
				{ data ? 'signed-in' : 'signed-out' }
			</span>
		);
	}

	function OtherReader() {
		useAuthUser();
		return null;
	}

	render(
		<ConnectorProvider connector={ connector }>
			<QueryClientProvider client={ createTestQueryClient() }>
				<Probe />
				<OtherReader />
			</QueryClientProvider>
		</ConnectorProvider>
	);
}

function signIn( connector: FakeConnector, user: AuthUser | null ) {
	connector.state.user = user;
	act( () => connector.emit( 'onAuthStateChanged' ) );
}

describe( 'useAuthUser', () => {
	// The login deeplink can land while the first auth lookup is still running.
	it( 'picks up a sign-in that lands mid-lookup', async () => {
		const connector = createFakeConnector( { user: null } );
		let finishFirstLookup: () => void = () => {};
		connector.getAuthUser.mockImplementationOnce(
			() =>
				new Promise< AuthUser | null >( ( resolve ) => {
					finishFirstLookup = () => resolve( null );
				} )
		);

		renderAuthUser( connector );
		await waitFor( () => expect( connector.getAuthUser ).toHaveBeenCalledTimes( 1 ) );

		// The pending request then settles with the pre-login answer.
		signIn( connector, TEST_USER );
		finishFirstLookup();

		await waitFor( () => expect( screen.getByTestId( 'state' ) ).toHaveTextContent( 'signed-in' ) );
	} );

	it( 'picks up a sign-in that lands after the lookup settles, looking it up once', async () => {
		const connector = createFakeConnector( { user: null } );

		renderAuthUser( connector );
		await waitFor( () =>
			expect( screen.getByTestId( 'state' ) ).toHaveTextContent( 'signed-out' )
		);

		signIn( connector, TEST_USER );

		await waitFor( () => expect( screen.getByTestId( 'state' ) ).toHaveTextContent( 'signed-in' ) );
		expect( connector.getAuthUser ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'says when the signed-in user changes, but not on the first lookup, and forgets its ready preview', async () => {
		const connector = createFakeConnector();

		renderAuthUser( connector );
		await waitFor( () => expect( screen.getByTestId( 'state' ) ).toHaveTextContent( 'signed-in' ) );
		expect( getNoticeHistory() ).toHaveLength( 0 );
		act( () => markPreviewReady( 'site' ) );
		expect( screen.getByTestId( 'state' ) ).toHaveAttribute( 'data-preview-ready', 'true' );

		signIn( connector, null );
		await waitFor( () =>
			expect( getNoticeHistory()[ 0 ]?.title ).toBe( 'Logged out of WordPress.com' )
		);
		expect( screen.getByTestId( 'state' ) ).toHaveAttribute( 'data-preview-ready', 'false' );

		signIn( connector, TEST_USER );
		await waitFor( () =>
			expect( getNoticeHistory()[ 0 ]?.title ).toBe( 'Logged in to WordPress.com' )
		);
	} );
} );
