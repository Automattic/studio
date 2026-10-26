import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAppMessagesForTests } from '@/data/app-messages';
import { setCommandPaletteOpen } from '@/data/use-command-palette';
import {
	createFakeConnector,
	makeSession,
	makeSite,
	TEST_USER,
	type FakeConnectorState,
} from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

const isApple = /Mac|iPhone|iPad/.test( navigator.platform );

function site( overrides: Partial< SiteDetails > = {} ) {
	return makeSite( { id: 'one', path: '/sites/my-site', ...overrides } );
}

function chat( overrides: Partial< AiSessionSummary > ) {
	return {
		summary: makeSession( {
			ownerSiteId: 'one',
			ownerSitePath: '/sites/my-site',
			updatedAt: new Date().toISOString(),
			...overrides,
		} ),
		entries: [],
	};
}

function setup( {
	sites = [ site() ],
	signedIn = true,
	path,
	...state
}: {
	sites?: SiteDetails[];
	signedIn?: boolean;
	path?: string;
} & Partial< FakeConnectorState > = {} ) {
	const connector = createFakeConnector( {
		sites,
		user: signedIn ? TEST_USER : null,
		...state,
		preferences: {
			autoCollapseSites: false,
			...state.preferences,
		} as FakeConnectorState[ 'preferences' ],
	} );
	const view = renderApp( { connector, path } );
	const ready = () => screen.findByRole( 'button', { name: 'Site actions for My site' } );
	const refreshSessions = async ( sessions: ReturnType< typeof chat >[] ) => {
		connector.state.sessions = [ ...connector.state.sessions, ...sessions ];
		await act( () => view.queryClient.invalidateQueries( { queryKey: [ 'sessions' ] } ) );
	};
	const setPreferences = async ( patch: Partial< FakeConnectorState[ 'preferences' ] > ) => {
		connector.state.preferences = { ...connector.state.preferences, ...patch };
		await act( () => view.queryClient.invalidateQueries( { queryKey: [ 'user-preferences' ] } ) );
	};
	return { ...view, ready, refreshSessions, setPreferences };
}

function sitesGroup() {
	return within( screen.getByRole( 'group', { name: 'Sites' } ) );
}

async function paletteCommand( query: string ) {
	fireEvent.keyDown( document, { code: 'KeyK', key: 'k', metaKey: isApple, ctrlKey: ! isApple } );
	fireEvent.change( await screen.findByLabelText( 'Search commands' ), {
		target: { value: query },
	} );
	fireEvent.click( await screen.findByRole( 'option', { name: new RegExp( `^${ query }` ) } ) );
	await waitFor( () =>
		expect( screen.queryByLabelText( 'Search commands' ) ).not.toBeInTheDocument()
	);
}

beforeEach( () => {
	localStorage.clear();
	resetAppMessagesForTests();
} );

afterEach( () => {
	act( () => setCommandPaletteOpen( false ) );
} );

describe( 'Sidebar in the Studio workspace', () => {
	it( 'collapses site groups through the palette while preserving the chat and draft', async () => {
		const { history, ready } = setup( {
			sites: [
				site( { running: true } ),
				site( { id: 'two', name: 'Second site', path: '/sites/second', running: true } ),
			],
			sessions: [
				chat( { id: 'collapse-chat', title: 'Keep open' } ),
				chat( {
					id: 'other-chat',
					title: 'Other chat',
					ownerSiteId: 'two',
					ownerSitePath: '/sites/second',
				} ),
			],
		} );
		await ready();
		fireEvent.click( screen.getByRole( 'button', { name: 'Second site' } ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/other-chat' ) );
		await paletteCommand( 'Keep open' );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/collapse-chat' ) );
		const input = await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
		await waitFor( () => expect( input ).toBeEnabled() );
		fireEvent.change( input, { target: { value: 'Keep the selected chat draft' } } );
		expect( screen.getByRole( 'button', { name: 'Collapse all' } ) ).toBeVisible();
		const groups = () =>
			Object.keys( localStorage ).filter( ( key ) => key.startsWith( 'studio-ui-sidebar-group-' ) );
		const stored = groups().map( ( key ) => localStorage.getItem( key ) );
		await paletteCommand( 'Collapse all' );
		for ( const name of [ 'My site', 'Second site' ] ) {
			expect( screen.getByRole( 'button', { name } ) ).toHaveAttribute( 'aria-expanded', 'false' );
		}
		expect( screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toBe( input );
		expect( input ).toHaveValue( 'Keep the selected chat draft' );
		expect( history.location.pathname ).toBe( '/sessions/collapse-chat' );
		expect( screen.queryByRole( 'button', { name: 'Collapse all' } ) ).not.toBeInTheDocument();
		expect( groups().map( ( key ) => localStorage.getItem( key ) ) ).toEqual( stored );
	} );

	it( 'hides and restores Recent without removing pinned chats or site history', async () => {
		const { ready, refreshSessions, setPreferences } = setup( {
			preferences: { sidebarPins: [ 'chat:pinned' ] } as never,
		} );
		await ready();
		await refreshSessions( [
			chat( { id: 'pinned', title: 'Pinned conversation' } ),
			chat( { id: 'recent', title: 'Recent conversation' } ),
		] );
		expect( await screen.findByRole( 'button', { name: 'Recent' } ) ).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		await setPreferences( { showRecentChats: false } );
		await waitFor( () =>
			expect( screen.queryByRole( 'group', { name: 'Recent' } ) ).not.toBeInTheDocument()
		);
		expect(
			within( screen.getByRole( 'group', { name: 'Pinned' } ) ).getByRole( 'button', {
				name: 'Pinned conversation',
			} )
		).toBeVisible();
		expect(
			await sitesGroup().findByRole( 'button', { name: 'Recent conversation' } )
		).toBeVisible();
		await setPreferences( { showRecentChats: true } );
		expect( await screen.findByRole( 'button', { name: 'Recent' } ) ).toBeVisible();
	} );

	it( 'orders site actions from left to right for keyboard navigation', async () => {
		const { ready } = setup( { signedIn: false } );
		await ready();
		const row = screen.getByRole( 'button', { name: /^My site$/ } ).closest( 'li' )!;
		expect(
			within( row )
				.getAllByRole( 'button' )
				.filter( ( action ) => action.closest( 'li' ) === row )
				.map( ( action ) => action.getAttribute( 'aria-label' ) || action.textContent )
		).toEqual( [ 'My site', 'New chat for My site', 'Start My site' ] );
	} );

	it( 'reveals site chats in batches of ten after the first five', async () => {
		const { history, ready, refreshSessions } = setup( { path: '/sites/one' } );
		await ready();
		await refreshSessions(
			Array.from( { length: 27 }, ( _, index ) =>
				chat( {
					id: `batch-chat-${ index }`,
					title: `Batch chat ${ index }`,
					updatedAt: new Date( 2026, 0, 27 - index ).toISOString(),
				} )
			)
		);
		const chats = () => within( screen.getByRole( 'group', { name: 'My site chats' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: /^My site$/ } ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/batch-chat-0' ) );
		await waitFor( () =>
			expect( chats().getAllByRole( 'button', { name: /^Batch chat / } ) ).toHaveLength( 5 )
		);
		fireEvent.click( chats().getByRole( 'button', { name: 'Show more' } ) );
		expect( chats().getAllByRole( 'button', { name: /^Batch chat / } ) ).toHaveLength( 15 );
		fireEvent.click( chats().getByRole( 'button', { name: 'Show more' } ) );
		expect( chats().getAllByRole( 'button', { name: /^Batch chat / } ) ).toHaveLength( 25 );
		fireEvent.click( chats().getByRole( 'button', { name: 'Show more' } ) );
		expect( chats().getAllByRole( 'button', { name: /^Batch chat / } ) ).toHaveLength( 27 );
		expect( chats().queryByRole( 'button', { name: 'Show more' } ) ).not.toBeInTheDocument();
		const toggleSite = async ( expanded: boolean ) => {
			fireEvent.click( screen.getByRole( 'button', { name: /^My site$/ } ) );
			await waitFor( () =>
				expect( screen.getByRole( 'button', { name: /^My site$/ } ) ).toHaveAttribute(
					'aria-expanded',
					String( expanded )
				)
			);
		};
		await toggleSite( false );
		await toggleSite( true );
		expect( chats().getAllByRole( 'button', { name: /^Batch chat / } ) ).toHaveLength( 5 );
		fireEvent.click( chats().getByRole( 'button', { name: 'Show more' } ) );
		expect( chats().getAllByRole( 'button', { name: /^Batch chat / } ) ).toHaveLength( 15 );
		await toggleSite( false );
		await toggleSite( true );
		expect( chats().getAllByRole( 'button', { name: /^Batch chat / } ) ).toHaveLength( 5 );
		expect( chats().getByRole( 'button', { name: 'Show more' } ) ).toBeInTheDocument();
	} );

	it( 'marks a chat unread from its context menu and clears it on opening', async () => {
		const { connector, ready, refreshSessions } = setup( { path: '/sites/one' } );
		await ready();
		await refreshSessions( [
			chat( { id: 'unread-chat', title: 'Homepage polish', unread: false } ),
		] );
		const chats = () => within( screen.getByRole( 'group', { name: 'My site chats' } ) );
		fireEvent.contextMenu( await chats().findByRole( 'button', { name: 'Homepage polish' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Mark as unread' } ) );
		await waitFor( () =>
			expect( screen.getAllByLabelText( 'Unread' ).length ).toBeGreaterThan( 0 )
		);
		expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'unread-chat', {
			unread: true,
		} );
		fireEvent.contextMenu( chats().getByRole( 'button', { name: /Homepage polish/ } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Mark as read' } ) );
		await waitFor( () => expect( screen.queryAllByLabelText( 'Unread' ) ).toHaveLength( 0 ) );
		expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'unread-chat', {
			unread: false,
		} );
		connector.updateSessionMetadata.mockClear();
		fireEvent.contextMenu( chats().getByRole( 'button', { name: /Homepage polish/ } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Mark as unread' } ) );
		await waitFor( () =>
			expect( screen.getAllByLabelText( 'Unread' ).length ).toBeGreaterThan( 0 )
		);
		fireEvent.click( chats().getByRole( 'button', { name: /Homepage polish/ } ) );
		await waitFor( () => expect( screen.queryAllByLabelText( 'Unread' ) ).toHaveLength( 0 ) );
		await waitFor( () =>
			expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'unread-chat', {
				unread: false,
			} )
		);
	} );

	it( 'pins an existing chat and removes it when archived', async () => {
		const { connector, ready, refreshSessions } = setup( { path: '/sites/one' } );
		await ready();
		await refreshSessions( [ chat( { id: 'pinned-chat', title: 'Homepage polish' } ) ] );
		const chats = within( await screen.findByRole( 'group', { name: 'My site chats' } ) );
		const row = await chats.findByRole( 'button', { name: 'Homepage polish' } );
		fireEvent.click( within( row.parentElement! ).getByRole( 'button', { name: 'Pin chat' } ) );
		const group = within( await screen.findByRole( 'group', { name: 'Pinned' } ) );
		const shortcut = group.getByRole( 'button', { name: 'Homepage polish' } );
		expect(
			screen.queryByRole( 'group', { name: 'My site chats' } )?.textContent ?? ''
		).not.toContain( 'Homepage polish' );
		await waitFor( () =>
			expect( connector.state.preferences.sidebarPins ).toEqual( [ 'chat:pinned-chat' ] )
		);
		expect(
			within( shortcut.parentElement!.parentElement! ).getByRole( 'button', {
				name: 'Unpin chat',
			} )
		).toBeInTheDocument();
		fireEvent.contextMenu( shortcut );
		expect( await screen.findByRole( 'menuitem', { name: 'Unpin' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Archive' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'group', { name: 'Pinned' } ) ).not.toBeInTheDocument()
		);
	} );

	it.each( [ false, true ] )(
		'archives a pinned chat without expanding its site (selected: %s)',
		async ( selected ) => {
			const { connector, history, ready, refreshSessions } = setup( {
				sites: [ site( { running: true } ) ],
				preferences: { sidebarPins: [ 'chat:pinned-chat' ] } as never,
			} );
			await ready();
			await waitFor( () => expect( history.location.pathname ).toMatch( /^\/sessions\// ) );
			await refreshSessions( [
				chat( { id: 'pinned-chat', title: 'Pinned conversation' } ),
				chat( { id: 'other-chat', title: 'Other conversation' } ),
			] );
			const pinnedGroup = () => within( screen.getByRole( 'group', { name: 'Pinned' } ) );
			const pinned = await waitFor( () =>
				pinnedGroup().getByRole( 'button', { name: 'Pinned conversation' } )
			);
			const siteRow = screen.getByRole( 'button', { name: 'My site' } );
			if ( siteRow.getAttribute( 'aria-expanded' ) === 'true' ) {
				fireEvent.click( siteRow );
			}
			if ( selected ) {
				fireEvent.click( pinned );
				await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/pinned-chat' ) );
			}
			const createCalls = connector.createSession.mock.calls.length;
			expect( siteRow ).toHaveAttribute( 'aria-expanded', 'false' );
			fireEvent.click(
				within( pinned.parentElement! ).getByRole( 'button', { name: 'Archive chat' } )
			);
			await waitFor( () =>
				expect( screen.queryAllByRole( 'button', { name: 'Pinned conversation' } ) ).toHaveLength(
					0
				)
			);
			expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'pinned-chat', {
				archived: true,
			} );
			expect( siteRow ).toHaveAttribute( 'aria-expanded', 'false' );
			expect( connector.createSession ).toHaveBeenCalledTimes( createCalls );
			fireEvent.click( await screen.findByRole( 'button', { name: 'Undo' } ) );
			await waitFor( () =>
				expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'pinned-chat', {
					archived: false,
				} )
			);
			await waitFor( () =>
				expect(
					pinnedGroup().getByRole( 'button', { name: 'Pinned conversation' } )
				).toBeInTheDocument()
			);
			expect( siteRow ).toHaveAttribute( 'aria-expanded', 'false' );
			expect( connector.createSession ).toHaveBeenCalledTimes( createCalls );
		}
	);
} );
