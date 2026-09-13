import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAuthUser } from './use-auth-user';
import type { AuthUser } from '@/data/core';

const SIGNED_IN_USER: AuthUser = { id: 1, email: 'user@example.com', displayName: 'Example User' };

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );

function renderAuthUser() {
	const queryClient = new QueryClient( {
		defaultOptions: { queries: { retry: false, staleTime: 0 } },
	} );

	function Probe() {
		const { data } = useAuthUser();
		return <span data-testid="state">{ data ? 'signed-in' : 'signed-out' }</span>;
	}

	render(
		<QueryClientProvider client={ queryClient }>
			<Probe />
		</QueryClientProvider>
	);
}

describe( 'useAuthUser', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	// The login deeplink can land while the first auth lookup is still running.
	it( 'picks up a sign-in that lands mid-lookup', async () => {
		let user: AuthUser | null = null;
		let finishFirstLookup: () => void = () => {};
		let lookups = 0;
		let notifyAuthChanged: () => void = () => {};

		useConnectorMock.mockReturnValue( {
			getAuthUser: vi.fn( () => {
				lookups += 1;
				if ( lookups === 1 ) {
					return new Promise< AuthUser | null >( ( resolve ) => {
						finishFirstLookup = () => resolve( null );
					} );
				}
				return Promise.resolve( user );
			} ),
			onAuthStateChanged: ( listener: () => void ) => {
				notifyAuthChanged = listener;
				return () => {};
			},
		} );

		renderAuthUser();
		await waitFor( () => expect( lookups ).toBe( 1 ) );

		// The pending request then settles with the pre-login answer.
		user = SIGNED_IN_USER;
		notifyAuthChanged();
		finishFirstLookup();

		await waitFor( () => expect( screen.getByTestId( 'state' ) ).toHaveTextContent( 'signed-in' ) );
	} );

	it( 'picks up a sign-in that lands after the lookup settles', async () => {
		let user: AuthUser | null = null;
		let notifyAuthChanged: () => void = () => {};

		useConnectorMock.mockReturnValue( {
			getAuthUser: vi.fn( () => Promise.resolve( user ) ),
			onAuthStateChanged: ( listener: () => void ) => {
				notifyAuthChanged = listener;
				return () => {};
			},
		} );

		renderAuthUser();
		await waitFor( () =>
			expect( screen.getByTestId( 'state' ) ).toHaveTextContent( 'signed-out' )
		);

		user = SIGNED_IN_USER;
		notifyAuthChanged();

		await waitFor( () => expect( screen.getByTestId( 'state' ) ).toHaveTextContent( 'signed-in' ) );
	} );
} );
