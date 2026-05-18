import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { useChats } from './context';
import { ChatsProvider } from './provider';
import type { Connector } from '@/data/core';
import type { AiSessionPlacementUpdatedEvent } from '@/data/core/types';

const routerMock = vi.hoisted( () => ( {
	navigate: vi.fn(),
	search: { chats: true, session: 'session-1' } as Record< string, unknown >,
} ) );

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => routerMock.navigate,
	useSearch: () => routerMock.search,
} ) );

describe( 'ChatsProvider session placement changes', () => {
	beforeEach( () => {
		routerMock.navigate.mockReset();
		routerMock.search = { chats: true, session: 'session-1' };
	} );

	it( 'asks before switching desks when the selected chat moves to another site', async () => {
		const { emitPlacement } = renderProvider();

		await waitFor( () =>
			expect( screen.getByTestId( 'selected-session' ) ).toHaveTextContent( 'session-1' )
		);
		routerMock.navigate.mockClear();

		emitPlacement( createPlacementEvent() );

		expect(
			await screen.findByRole( 'dialog', { name: 'Continue in the site desk?' } )
		).toBeVisible();
		expect( screen.getByText( /site desk for Created Site/ ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Switch desks' } ) ).toHaveFocus();
		expect( routerMock.navigate ).not.toHaveBeenCalled();
	} );

	it( 'switches to the new site desk when confirmed', async () => {
		const { emitPlacement } = renderProvider();

		await waitFor( () =>
			expect( screen.getByTestId( 'selected-session' ) ).toHaveTextContent( 'session-1' )
		);
		routerMock.navigate.mockClear();

		emitPlacement( createPlacementEvent() );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Switch desks' } ) );

		expect( routerMock.navigate ).toHaveBeenCalledTimes( 1 );
		const navigation = routerMock.navigate.mock.calls[ 0 ][ 0 ];
		expect( navigation.to ).toBe( '/sites/$siteId' );
		expect( navigation.params ).toEqual( { siteId: 'site-2' } );
		expect( navigation.search( { existing: true } ) ).toEqual( {
			existing: true,
			chats: true,
			session: 'session-1',
		} );
	} );

	it( 'stays on the current desk by closing the chat sidebar', async () => {
		const { emitPlacement } = renderProvider();

		await waitFor( () =>
			expect( screen.getByTestId( 'selected-session' ) ).toHaveTextContent( 'session-1' )
		);
		routerMock.navigate.mockClear();

		emitPlacement( createPlacementEvent() );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Stay here' } ) );

		await waitFor( () =>
			expect( screen.getByTestId( 'selected-session' ) ).toHaveTextContent( 'none' )
		);
		expect(
			screen.queryByRole( 'dialog', { name: 'Continue in the site desk?' } )
		).not.toBeInTheDocument();
		expect( routerMock.navigate ).toHaveBeenCalledTimes( 1 );
		const navigation = routerMock.navigate.mock.calls[ 0 ][ 0 ];
		expect( navigation.to ).toBe( '.' );
		expect( navigation.search( { chats: true, session: 'session-1', existing: true } ) ).toEqual( {
			chats: undefined,
			session: undefined,
			existing: true,
		} );
	} );
} );

function renderProvider( siteId?: string ) {
	let placementListener: ( ( event: AiSessionPlacementUpdatedEvent ) => void ) | undefined;
	const queryClient = new QueryClient( {
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	} );
	const connector = {
		onSessionPlacementUpdated: vi.fn( ( listener ) => {
			placementListener = listener;
			return vi.fn();
		} ),
		createSession: vi.fn(),
	} as unknown as Connector;

	render(
		<QueryClientProvider client={ queryClient }>
			<ConnectorProvider connector={ connector }>
				<ChatsProvider siteId={ siteId }>
					<SelectedSessionStatus />
				</ChatsProvider>
			</ConnectorProvider>
		</QueryClientProvider>
	);

	return {
		emitPlacement: ( event: AiSessionPlacementUpdatedEvent ) => {
			if ( ! placementListener ) {
				throw new Error( 'No placement listener registered.' );
			}
			act( () => {
				placementListener?.( event );
			} );
		},
	};
}

function SelectedSessionStatus() {
	const { selectedSessionId } = useChats();
	return <div data-testid="selected-session">{ selectedSessionId ?? 'none' }</div>;
}

function createPlacementEvent(): AiSessionPlacementUpdatedEvent {
	return {
		sessionId: 'session-1',
		placement: {
			kind: 'site',
			siteId: 'site-2',
			siteName: 'Created Site',
			sitePath: '/sites/created-site',
		},
	};
}
