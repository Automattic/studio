import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

const site = makeSite( { id: 's', name: 'Site' } );
const chat = ( id: string, unread = false ) => ( {
	summary: makeSession( { id, ownerSiteId: 's', firstPrompt: `Chat ${ id }`, unread } ),
	entries: [],
} );

afterEach( () => vi.restoreAllMocks() );

describe( 'chat read state', () => {
	it( 'does not mark a hidden chat read until the window gains focus', async () => {
		const focus = vi.spyOn( document, 'hasFocus' ).mockReturnValue( false );
		const connector = createFakeConnector( {
			sites: [ site ],
			sessions: [ chat( 'chat-1', true ) ],
		} );
		renderApp( { connector, path: '/sessions/chat-1' } );
		await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
		expect( connector.updateSessionMetadata ).not.toHaveBeenCalled();
		focus.mockReturnValue( true );
		await act( () => window.dispatchEvent( new Event( 'focus' ) ) );
		await waitFor( () =>
			expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'chat-1', { unread: false } )
		);
	} );
} );
