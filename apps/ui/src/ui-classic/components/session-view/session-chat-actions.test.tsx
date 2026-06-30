import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getSiteSessionHistory, SessionChatActions } from './session-chat-actions';
import type { AiSessionSummary } from '@/data/core';

describe( 'getSiteSessionHistory', () => {
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
} );

describe( 'SessionChatActions', () => {
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
