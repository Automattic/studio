import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getSiteArchivedSessionHistory,
	getSiteSessionHistory,
	SessionChatActions,
} from './session-chat-actions';
import type { AiSessionSummary } from '@/data/core';

const updateSessionMetadataMutate = vi.hoisted( () => vi.fn() );

vi.mock( '@/data/queries/use-sessions', () => ( {
	useUpdateSessionMetadata: () => ( {
		mutate: updateSessionMetadataMutate,
	} ),
} ) );

describe( 'getSiteSessionHistory', () => {
	beforeEach( () => {
		updateSessionMetadataMutate.mockClear();
	} );

	it( 'returns non-archived sessions for the owner site newest-first', () => {
		const currentSession = createSession( {
			id: 'current',
			ownerSitePath: '/Users/example/Studio/demo-site',
			updatedAt: '2026-06-20T12:00:00.000Z',
		} );

		const history = getSiteSessionHistory( {
			currentSession,
			ownerSitePath: '/Users/example/Studio/demo-site',
			sessions: [
				createSession( {
					id: 'other-site',
					ownerSitePath: '/Users/example/Studio/other-site',
					updatedAt: '2026-06-30T12:00:00.000Z',
				} ),
				createSession( {
					id: 'archived',
					archived: true,
					ownerSitePath: '/Users/example/Studio/demo-site',
					updatedAt: '2026-06-29T12:00:00.000Z',
				} ),
				createSession( {
					id: 'older',
					ownerSitePath: '/Users/example/Studio/demo-site',
					updatedAt: '2026-06-19T12:00:00.000Z',
				} ),
				createSession( {
					id: 'newest',
					ownerSitePath: '/Users/example/Studio/demo-site',
					updatedAt: '2026-06-21T12:00:00.000Z',
				} ),
			],
		} );

		expect( history.map( ( session ) => session.id ) ).toEqual( [ 'newest', 'current', 'older' ] );
	} );

	it( 'returns archived sessions for the owner site newest-first', () => {
		const currentSession = createSession( {
			id: 'current',
			archived: true,
			ownerSitePath: '/Users/example/Studio/demo-site',
			updatedAt: '2026-06-20T12:00:00.000Z',
		} );

		const history = getSiteArchivedSessionHistory( {
			currentSession,
			ownerSitePath: '/Users/example/Studio/demo-site',
			sessions: [
				createSession( {
					id: 'active',
					ownerSitePath: '/Users/example/Studio/demo-site',
					updatedAt: '2026-06-30T12:00:00.000Z',
				} ),
				createSession( {
					id: 'other-site',
					archived: true,
					ownerSitePath: '/Users/example/Studio/other-site',
					updatedAt: '2026-06-30T12:00:00.000Z',
				} ),
				createSession( {
					id: 'newest',
					archived: true,
					ownerSitePath: '/Users/example/Studio/demo-site',
					updatedAt: '2026-06-21T12:00:00.000Z',
				} ),
			],
		} );

		expect( history.map( ( session ) => session.id ) ).toEqual( [ 'newest', 'current' ] );
	} );
} );

describe( 'SessionChatActions', () => {
	beforeEach( () => {
		updateSessionMetadataMutate.mockClear();
	} );

	it( 'starts a new chat from the footer', () => {
		const onNewChat = vi.fn();

		render(
			<SessionChatActions
				currentSessionId="current"
				onNewChat={ onNewChat }
				onSwitchSession={ vi.fn() }
				sessions={ [ createSession( { id: 'current', firstPrompt: 'Current chat' } ) ] }
			/>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'New chat' } ) );

		expect( onNewChat ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'keeps the history button first and exposes the new chat shortcut', () => {
		render(
			<SessionChatActions
				currentSessionId="current"
				onNewChat={ vi.fn() }
				onSwitchSession={ vi.fn() }
				sessions={ [ createSession( { id: 'current', firstPrompt: 'Current chat' } ) ] }
			/>
		);

		const historyButton = screen.getByRole( 'button', { name: 'Chat history' } );
		const newChatButton = screen.getByRole( 'button', { name: 'New chat' } );

		expect(
			historyButton.compareDocumentPosition( newChatButton ) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect( newChatButton ).toHaveAttribute( 'aria-keyshortcuts', expect.stringMatching( /\+N$/ ) );
	} );

	it( 'starts a new chat from the keyboard shortcut', () => {
		const onNewChat = vi.fn();

		render(
			<SessionChatActions
				currentSessionId="current"
				onNewChat={ onNewChat }
				onSwitchSession={ vi.fn() }
				sessions={ [ createSession( { id: 'current', firstPrompt: 'Current chat' } ) ] }
			/>
		);

		const shortcut = screen
			.getByRole( 'button', { name: 'New chat' } )
			.getAttribute( 'aria-keyshortcuts' );

		fireEvent.keyDown( document, {
			key: 'n',
			ctrlKey: shortcut?.startsWith( 'Control+' ),
			metaKey: shortcut?.startsWith( 'Meta+' ),
		} );

		expect( onNewChat ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'shows tooltips for chat history and new chat', async () => {
		render(
			<SessionChatActions
				currentSessionId="current"
				onNewChat={ vi.fn() }
				onSwitchSession={ vi.fn() }
				sessions={ [ createSession( { id: 'current', firstPrompt: 'Current chat' } ) ] }
			/>
		);

		const historyButton = screen.getByRole( 'button', { name: 'Chat history' } );
		fireEvent.mouseEnter( historyButton );
		fireEvent.mouseMove( historyButton, { movementX: 1, movementY: 1 } );

		expect( await screen.findByText( 'Chat history' ) ).toBeVisible();

		const newChatButton = screen.getByRole( 'button', { name: 'New chat' } );
		fireEvent.mouseEnter( newChatButton );
		fireEvent.mouseMove( newChatButton, { movementX: 1, movementY: 1 } );

		expect( await screen.findByText( /^New chat / ) ).toBeVisible();
	} );

	it( 'opens chat history and switches to a previous chat', async () => {
		const onSwitchSession = vi.fn();

		render(
			<SessionChatActions
				currentSessionId="current"
				onNewChat={ vi.fn() }
				onSwitchSession={ onSwitchSession }
				sessions={ [
					createSession( { id: 'current', firstPrompt: 'Current chat' } ),
					createSession( { id: 'older', firstPrompt: 'Older chat' } ),
				] }
			/>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Chat history' } ) );

		const currentItem = ( await screen.findByText( 'Current chat' ) ).closest(
			'[role="menuitem"]'
		);
		const olderItem = screen.getByText( 'Older chat' ).closest( '[role="menuitem"]' );

		expect( currentItem ).toHaveAttribute( 'aria-current', 'page' );
		expect( currentItem ).toHaveAttribute( 'data-current', 'true' );
		expect( olderItem ).toBeInTheDocument();

		fireEvent.click( olderItem! );

		expect( onSwitchSession ).toHaveBeenCalledWith( 'older' );
	} );

	it( 'shows chat title and compact relative time on one history row', () => {
		vi.useFakeTimers();
		vi.setSystemTime( new Date( '2026-06-30T12:00:00.000Z' ) );

		try {
			render(
				<SessionChatActions
					currentSessionId="current"
					onNewChat={ vi.fn() }
					onSwitchSession={ vi.fn() }
					sessions={ [
						createSession( {
							id: 'current',
							firstPrompt: 'Current chat',
							updatedAt: '2026-06-30T10:00:00.000Z',
						} ),
					] }
				/>
			);

			fireEvent.click( screen.getByRole( 'button', { name: 'Chat history' } ) );

			const item = screen.getByText( 'Current chat' ).closest< HTMLElement >( '[role="menuitem"]' );
			expect( item ).toBeInTheDocument();
			expect( within( item! ).getByText( '2h' ) ).toBeInTheDocument();
			expect( within( item! ).queryByText( /Updated/ ) ).not.toBeInTheDocument();
		} finally {
			vi.useRealTimers();
		}
	} );

	it( 'archives a chat from the history row trailing action', async () => {
		const onSwitchSession = vi.fn();

		render(
			<SessionChatActions
				currentSessionId="current"
				onNewChat={ vi.fn() }
				onSwitchSession={ onSwitchSession }
				sessions={ [
					createSession( { id: 'current', firstPrompt: 'Current chat' } ),
					createSession( {
						id: 'older',
						firstPrompt: 'Older chat',
						starred: true,
					} ),
				] }
			/>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Chat history' } ) );
		const olderItem = ( await screen.findByText( 'Older chat' ) ).closest< HTMLElement >(
			'[role="menuitem"]'
		);
		fireEvent.click( within( olderItem! ).getByRole( 'button', { name: 'Archive chat' } ) );

		expect( updateSessionMetadataMutate ).toHaveBeenCalledWith( {
			sessionId: 'older',
			patch: {
				starred: true,
				archived: true,
			},
		} );
		expect( onSwitchSession ).not.toHaveBeenCalled();
	} );

	it( 'opens archived chats in a separate dialog', async () => {
		const onSwitchSession = vi.fn();

		render(
			<SessionChatActions
				archivedSessions={ [
					createSession( {
						id: 'archived',
						archived: true,
						firstPrompt: 'Archived chat',
					} ),
				] }
				currentSessionId="current"
				onNewChat={ vi.fn() }
				onSwitchSession={ onSwitchSession }
				sessions={ [ createSession( { id: 'current', firstPrompt: 'Current chat' } ) ] }
			/>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Chat history' } ) );
		fireEvent.click( await screen.findByText( 'Archived chats' ) );
		const archivedChatButton = await screen.findByRole( 'button', { name: /Archived chat/ } );

		expect( archivedChatButton ).not.toHaveFocus();

		fireEvent.click( archivedChatButton );

		expect( onSwitchSession ).toHaveBeenCalledWith( 'archived' );
	} );
} );

function createSession( overrides: Partial< AiSessionSummary > = {} ): AiSessionSummary {
	return {
		id: 'session-1',
		filePath: '/Users/example/.studio/sessions/session-1.jsonl',
		createdAt: '2026-06-01T12:00:00.000Z',
		updatedAt: '2026-06-20T12:00:00.000Z',
		firstPrompt: 'Site chat',
		ownerSitePath: '/Users/example/Studio/demo-site',
		activeEnvironment: 'local',
		eventCount: 1,
		...overrides,
	};
}
