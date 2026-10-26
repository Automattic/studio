import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { AiSessionSummary } from '@/data/core';

it( 'restores an archived pinned chat to its pinned place', async () => {
	const site = makeSite( { id: 's', name: 'Site' } );
	const sessions = [ 'a', 'b', 'c' ].map( ( id ) => ( {
		summary: makeSession( { id, ownerSiteId: 's', firstPrompt: `Chat ${ id }` } ),
		entries: [],
	} ) );
	const pins = [ 'chat:a', 'site:s', 'chat:b' ];
	const connector = createFakeConnector( {
		sites: [ site ],
		sessions,
		preferences: { sidebarPins: pins } as never,
	} );
	const { queryClient, history } = renderApp( { connector, path: '/sessions/c' } );
	await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/c' ) );
	const pinned = await screen.findByRole( 'group', { name: 'Pinned' } );
	await within( pinned ).findByText( 'Chat a' );
	fireEvent.click( within( pinned ).getAllByRole( 'button', { name: 'Archive chat' } )[ 0 ] );
	await waitFor( () =>
		expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'a', { archived: true } )
	);
	await waitFor( () => expect( within( pinned ).queryByText( 'Chat a' ) ).not.toBeInTheDocument() );
	fireEvent.click( await screen.findByRole( 'button', { name: 'Undo' } ) );
	await waitFor( () =>
		expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'a', { archived: false } )
	);
	expect( connector.state.preferences.sidebarPins ).toEqual( pins );
	expect( await within( pinned ).findByText( 'Chat a' ) ).toBeVisible();
	expect(
		queryClient
			.getQueryData< AiSessionSummary[] >( SESSIONS_QUERY_KEY )
			?.find( ( session ) => session.id === 'a' )?.archived
	).toBe( false );
} );
