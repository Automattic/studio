import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

it.each( [ 'type', 'manual' ] as const )(
	'restores an archived pinned chat to its pinned place with %s sorting',
	async ( sidebarPinnedSort ) => {
		const site = makeSite( { id: 's', name: 'Site' } );
		const sessions = [ 'a', 'b', 'c' ].map( ( id ) => ( {
			summary: makeSession( { id, ownerSiteId: 's', firstPrompt: `Chat ${ id }` } ),
			entries: [],
		} ) );
		const pins = [ 'chat:a', 'site:s', 'chat:b' ];
		const connector = createFakeConnector( {
			sites: [ site ],
			sessions,
			preferences: { sidebarPins: pins, sidebarPinnedSort },
		} );
		const { history } = renderApp( { connector, path: '/sessions/c' } );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/c' ) );
		const pinned = await screen.findByRole( 'group', { name: 'Pinned' } );
		const chatRow = ( await within( pinned ).findByRole( 'button', { name: 'Chat a' } ) ).closest(
			'li'
		)!;
		fireEvent.click( within( chatRow ).getByRole( 'button', { name: 'Archive chat' } ) );
		await waitFor( () =>
			expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'a', { archived: true } )
		);
		await waitFor( () =>
			expect( within( pinned ).queryByText( 'Chat a' ) ).not.toBeInTheDocument()
		);
		fireEvent.click( await screen.findByRole( 'button', { name: 'Undo' } ) );
		await waitFor( () =>
			expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'a', { archived: false } )
		);
		expect( connector.state.preferences.sidebarPins ).toEqual( pins );
		expect( await within( pinned ).findByText( 'Chat a' ) ).toBeVisible();
	}
);
