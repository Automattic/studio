import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { AgentRunEvent } from '@/data/core';
import type { FakeConnector } from '@/test/fake-connector';

const site = makeSite( { id: 's', name: 'Site' } );
const chat = ( id: string, unread = false ) => ( {
	summary: makeSession( { id, ownerSiteId: 's', firstPrompt: `Chat ${ id }`, unread } ),
	entries: [],
} );

afterEach( () => vi.restoreAllMocks() );

async function openChat( unread = false ) {
	const connector = createFakeConnector( {
		sites: [ site ],
		sessions: [ chat( 'chat-1', unread ) ],
	} );
	renderApp( { connector, path: '/sessions/chat-1' } );
	await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
	return connector;
}

function emitRun( connector: FakeConnector, type: 'run.started' | 'run.exited' ) {
	act( () =>
		connector.emit( 'onAgentEvent', {
			sessionId: 'chat-1',
			runId: 'run-1',
			event: { type, timestamp: new Date().toISOString() } as AgentRunEvent[ 'event' ],
		} )
	);
}

const markedRead = ( connector: FakeConnector ) =>
	connector.updateSessionMetadata.mock.calls.filter( ( [ , patch ] ) => patch.unread === false )
		.length;

describe( 'chat read state', () => {
	it( 'does not mark a hidden chat read until the window gains focus', async () => {
		const focus = vi.spyOn( document, 'hasFocus' ).mockReturnValue( false );
		const connector = await openChat( true );
		expect( connector.updateSessionMetadata ).not.toHaveBeenCalled();
		focus.mockReturnValue( true );
		await act( () => window.dispatchEvent( new Event( 'focus' ) ) );
		await waitFor( () =>
			expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'chat-1', { unread: false } )
		);
	} );

	it( 'keeps the open chat unread when marked by hand until its window comes back', async () => {
		vi.spyOn( document, 'hasFocus' ).mockReturnValue( true );
		const connector = await openChat();
		const chats = await screen.findByRole( 'group', { name: 'Site chats' } );
		const openMenu = () =>
			fireEvent.contextMenu( within( chats ).getByRole( 'button', { name: /Chat chat-1/ } ) );
		openMenu();
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Mark as unread' } ) );
		await waitFor( () =>
			expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'chat-1', { unread: true } )
		);
		openMenu();
		expect( await screen.findByRole( 'menuitem', { name: 'Mark as read' } ) ).toBeVisible();
		expect( markedRead( connector ) ).toBe( 0 );
		fireEvent.keyDown( document.activeElement!, { key: 'Escape' } );

		await act( () => window.dispatchEvent( new Event( 'focus' ) ) );
		await waitFor( () => expect( markedRead( connector ) ).toBe( 1 ) );
	} );

	it( 'clears the unread flag a turn ending in view brings', async () => {
		vi.spyOn( document, 'hasFocus' ).mockReturnValue( true );
		const connector = await openChat();
		emitRun( connector, 'run.started' );
		connector.state.sessions[ 0 ].summary.unread = true;
		emitRun( connector, 'run.exited' );
		await waitFor( () =>
			expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'chat-1', { unread: false } )
		);
	} );
} );
