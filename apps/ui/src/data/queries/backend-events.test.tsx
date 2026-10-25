import { act, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '@/app/app-providers';
import { getVisibleToasts } from '@/data/app-messages';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useSessions } from '@/data/queries/use-sessions';
import { TEST_USER, createFakeConnector } from '@/test/fake-connector';
import { createTestQueryClient, renderWithProviders } from '@/test/render';
import type { AuthUser } from '@/data/core';

function Consumer() {
	useAuthUser();
	useSessions();
	return null;
}

function setup( user: AuthUser | null = null ) {
	const connector = createFakeConnector( { user } );
	const view = renderWithProviders(
		Array.from( { length: 20 }, ( _, index ) => <Consumer key={ index } /> ),
		{ connector }
	);
	const settle = () => waitFor( () => expect( view.queryClient.isFetching() ).toBe( 0 ) );
	const authChanged = () => act( () => connector.emit( 'onAuthStateChanged' ) );
	return { ...view, settle, authChanged };
}

const toastTitles = () => getVisibleToasts().map( ( toast ) => toast.title );

describe( 'account and session events', () => {
	it.each( [ null, TEST_USER ] )( 'keeps the initial account state quiet (%j)', async ( user ) => {
		const { settle } = setup( user );
		await settle();
		expect( getVisibleToasts() ).toHaveLength( 0 );
	} );

	it( 'confirms login and logout once after the account state changes', async () => {
		const { connector, settle, authChanged } = setup();
		await settle();
		connector.state.user = TEST_USER;
		authChanged();
		await waitFor( () => expect( toastTitles() ).toEqual( [ 'Logged in to WordPress.com' ] ) );
		authChanged();
		await settle();
		expect( getVisibleToasts() ).toHaveLength( 1 );
		connector.state.user = null;
		authChanged();
		await waitFor( () =>
			expect( toastTitles() ).toEqual( [
				'Logged in to WordPress.com',
				'Logged out of WordPress.com',
			] )
		);
	} );

	it( 'does not announce logout when refreshing the account fails', async () => {
		const { connector, settle, authChanged } = setup( TEST_USER );
		await settle();
		connector.getAuthUser.mockRejectedValueOnce( new Error( 'Offline' ) );
		authChanged();
		await settle();
		expect( getVisibleToasts() ).toHaveLength( 0 );
		authChanged();
		await settle();
		expect( getVisibleToasts() ).toHaveLength( 0 );
	} );

	it( 'unsubscribes on unmount', async () => {
		const { connector, settle, unmount } = setup();
		await settle();
		expect( connector.listenerCount( 'onAuthStateChanged' ) ).toBeGreaterThan( 0 );
		expect( connector.listenerCount( 'onSessionPlacementUpdated' ) ).toBe( 1 );
		unmount();
		expect( connector.listenerCount( 'onAuthStateChanged' ) ).toBe( 0 );
		expect( connector.listenerCount( 'onSessionPlacementUpdated' ) ).toBe( 0 );
	} );

	it( 'cleans up Strict Mode remounts before subscribing again', () => {
		const connector = createFakeConnector();
		const app = ( strict: boolean ) => {
			const tree = (
				<AppProviders connector={ connector } queryClient={ createTestQueryClient() }>
					{ null }
				</AppProviders>
			);
			return strict ? <StrictMode>{ tree }</StrictMode> : tree;
		};
		const plain = render( app( false ) );
		const subscriptions = connector.listenerCount( 'onAuthStateChanged' );
		plain.unmount();
		const view = render( app( true ) );
		expect( connector.listenerCount( 'onAuthStateChanged' ) ).toBe( subscriptions );
		expect( connector.listenerCount( 'onSessionPlacementUpdated' ) ).toBe( 1 );
		view.unmount();
		expect( connector.listenerCount( 'onAuthStateChanged' ) ).toBe( 0 );
		expect( connector.listenerCount( 'onSessionPlacementUpdated' ) ).toBe( 0 );
	} );
} );
