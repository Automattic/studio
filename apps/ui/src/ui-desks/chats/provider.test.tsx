import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { useChats } from './context';
import { ChatsProvider } from './provider';
import type { AuthUser, Connector } from '@/data/core';
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

	it( 'does not create a chat when the user is logged out', async () => {
		routerMock.search = { chats: true };
		const { connector } = renderProvider( { authUser: null } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Start new chat' } ) );

		await waitFor( () =>
			expect( screen.getByTestId( 'expanded' ) ).toHaveTextContent( 'expanded' )
		);
		expect( connector.createSession ).not.toHaveBeenCalled();
		expect( screen.getByTestId( 'selected-session' ) ).toHaveTextContent( 'none' );
	} );

	it( 'keeps a prompt for the login-required state instead of creating a chat', async () => {
		routerMock.search = { chats: true };
		const { connector } = renderProvider( { authUser: null } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Start prompt chat' } ) );

		await waitFor( () =>
			expect( screen.getByTestId( 'auth-required-prompt' ) ).toHaveTextContent( 'Draft prompt' )
		);
		expect( connector.createSession ).not.toHaveBeenCalled();
		expect( screen.getByTestId( 'selected-session' ) ).toHaveTextContent( 'none' );
	} );

	it( 'creates and selects a chat when the user is logged in', async () => {
		routerMock.search = { chats: true };
		const { connector } = renderProvider();

		fireEvent.click( screen.getByRole( 'button', { name: 'Start new chat' } ) );

		await waitFor( () =>
			expect( screen.getByTestId( 'selected-session' ) ).toHaveTextContent( 'created-session' )
		);
		expect( connector.createSession ).toHaveBeenCalledTimes( 1 );
	} );
} );

function renderProvider( {
	siteId,
	authUser = createAuthUser(),
}: {
	siteId?: string;
	authUser?: AuthUser | null;
} = {} ) {
	let placementListener: ( ( event: AiSessionPlacementUpdatedEvent ) => void ) | undefined;
	const queryClient = new QueryClient( {
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	} );
	const connector = {
		getAuthUser: vi.fn().mockResolvedValue( authUser ),
		onAuthStateChanged: vi.fn( () => vi.fn() ),
		onSessionPlacementUpdated: vi.fn( ( listener ) => {
			placementListener = listener;
			return vi.fn();
		} ),
		createSession: vi.fn().mockResolvedValue( {
			id: 'created-session',
		} ),
	} as unknown as Connector;

	render(
		<QueryClientProvider client={ queryClient }>
			<ConnectorProvider connector={ connector }>
				<ChatsProvider siteId={ siteId }>
					<ChatStateStatus />
					<StartChatButtons />
				</ChatsProvider>
			</ConnectorProvider>
		</QueryClientProvider>
	);

	return {
		connector,
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

function ChatStateStatus() {
	const { selectedSessionId, expanded, authRequiredPrompt } = useChats();
	return (
		<>
			<div data-testid="selected-session">{ selectedSessionId ?? 'none' }</div>
			<div data-testid="expanded">{ expanded ? 'expanded' : 'collapsed' }</div>
			<div data-testid="auth-required-prompt">{ authRequiredPrompt?.displayMessage ?? 'none' }</div>
		</>
	);
}

function StartChatButtons() {
	const { startNewChat, startChatWithPrompt } = useChats();
	return (
		<>
			<button type="button" onClick={ () => void startNewChat() }>
				Start new chat
			</button>
			<button
				type="button"
				onClick={ () =>
					void startChatWithPrompt( {
						prompt: 'Full prompt',
						displayMessage: 'Draft prompt',
					} )
				}
			>
				Start prompt chat
			</button>
		</>
	);
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

function createAuthUser(): AuthUser {
	return {
		id: 1,
		email: 'user@example.com',
		displayName: 'Studio User',
	};
}
