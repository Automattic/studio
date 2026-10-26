import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SiteChats } from './site-chats';

const site = makeSite();
const chats = Array.from( { length: 23 }, ( _, index ) =>
	makeSession( { id: `chat-${ index }`, ownerSiteId: site.id, firstPrompt: `Chat ${ index }` } )
);

describe( 'sidebar chat pagination', () => {
	it( 'keeps manual pagination and its collapse reset', async () => {
		let setExpanded!: ( expanded: boolean ) => void;
		function ChatList() {
			const [ expanded, set ] = useState( true );
			setExpanded = set;
			return (
				<SiteChats
					site={ site }
					chats={ chats }
					open={ expanded }
					expanded={ expanded }
					loadError={ false }
					reorderable={ false }
					onReorderChats={ () => {} }
				/>
			);
		}
		renderWithProviders( <ChatList />, { connector: createFakeConnector( { sites: [ site ] } ) } );
		const rows = () => screen.queryAllByText( /^Chat \d+$/ );
		await screen.findByText( 'Chat 0' );
		expect( rows() ).toHaveLength( 5 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Show more' } ) );
		expect( rows() ).toHaveLength( 15 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Show more' } ) );
		expect( rows() ).toHaveLength( 23 );
		expect( screen.queryByRole( 'button', { name: 'Show more' } ) ).not.toBeInTheDocument();
		act( () => setExpanded( false ) );
		act( () => setExpanded( true ) );
		expect( rows() ).toHaveLength( 5 );
	} );
} );
