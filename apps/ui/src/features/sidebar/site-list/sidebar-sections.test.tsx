import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { AgentRunEvent, AiSessionSummary, UserPreferences } from '@/data/core';
import type { FakeConnector } from '@/test/fake-connector';

const SHORTCUTS = /Ctrl\+Alt\+[PRS]|⌥⌘[PRS]|Ctrl\+Shift\+A|⇧⌘A/g;

const site = makeSite( { id: 'one', name: 'My site', path: '/sites/my-site' } );
const second = makeSite( { id: 'two', name: 'Second site', path: '/sites/second' } );

function chat( id: string, siteId: string, overrides: Partial< AiSessionSummary > = {} ) {
	const owner = siteId === 'one' ? site : second;
	return {
		summary: makeSession( {
			id,
			title: id,
			ownerSiteId: owner.id,
			ownerSitePath: owner.path,
			updatedAt: new Date().toISOString(),
			...overrides,
		} ),
		entries: [],
	};
}

function setup( {
	sites = [ site, second ],
	sessions = [],
	preferences = {},
	path = '/sites/one',
}: {
	sites?: ReturnType< typeof makeSite >[];
	sessions?: ReturnType< typeof chat >[];
	preferences?: Partial< UserPreferences >;
	path?: string;
} = {} ) {
	const connector = createFakeConnector( {
		sites,
		sessions,
		preferences,
	} );
	return renderApp( { connector, path } );
}

const group = ( name: string ) => within( screen.getByRole( 'group', { name } ) );

function emit( connector: FakeConnector, sessionId: string, event: AgentRunEvent[ 'event' ] ) {
	act( () => connector.emit( 'onAgentEvent', { sessionId, runId: `${ sessionId }-run`, event } ) );
}

const question = (): AgentRunEvent[ 'event' ] => ( {
	type: 'question.asked',
	timestamp: new Date().toISOString(),
	questions: [ { question: 'Continue?', options: [ { label: 'Yes', description: '' } ] } ],
} );

const exited = (): AgentRunEvent[ 'event' ] => ( {
	type: 'run.exited',
	timestamp: new Date().toISOString(),
	status: 'success',
	code: 0,
} );

beforeEach( () => {
	localStorage.clear();
} );

describe( 'sidebar site sections', () => {
	it( 'keeps one selected chat through navigation and pinning', async () => {
		const { history } = setup( {
			sessions: [ chat( 'first', 'one' ) ],
			preferences: { sidebarPins: [ 'site:one' ] },
			path: '/sessions/first',
		} );
		const shortcuts = within( await screen.findByRole( 'group', { name: 'Recent' } ) );
		const siteChats = within( screen.getByRole( 'group', { name: 'My site chats' } ) );
		const siteChat = siteChats.getByRole( 'button', { name: 'First' } );
		const shortcutChat = shortcuts.getByRole( 'button', { name: 'First' } );
		const selected = () => screen.getByRole( 'button', { name: 'First', current: 'page' } );
		expect( selected() ).toBe( siteChat );

		fireEvent.click( shortcutChat );
		await waitFor( () => expect( selected() ).toBe( shortcutChat ) );
		for ( const [ open, close ] of [
			[ 'Settings', 'Close settings' ],
			[ 'Add site', 'Close Add site' ],
		] ) {
			fireEvent.click( screen.getByRole( 'button', { name: open } ) );
			const dialog = await screen.findByRole( 'dialog', { name: open } );
			expect( shortcutChat ).toHaveAttribute( 'aria-current', 'page' );
			fireEvent.click( within( dialog ).getByRole( 'button', { name: close } ) );
			await waitFor( () => expect( selected() ).toBe( shortcutChat ) );
		}
		fireEvent.click( siteChat );
		await waitFor( () => expect( selected() ).toBe( siteChat ) );

		await act( () => history.back() );
		await waitFor( () => expect( selected() ).toBe( shortcutChat ) );
		await act( () => history.forward() );
		await waitFor( () => expect( selected() ).toBe( siteChat ) );

		fireEvent.contextMenu( siteChat );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Pin' } ) );
		await waitFor( () => expect( siteChat ).not.toBeInTheDocument() );
		const pinnedChat = await group( 'Pinned' ).findByRole( 'button', { name: 'First' } );
		await waitFor( () => expect( selected() ).toBe( pinnedChat ) );
		await act( () => history.replace( '/sessions/first' ) );
		await waitFor( () => expect( selected() ).toBe( pinnedChat ) );
	} );

	it( 'opens a Recent chat without expanding its site', async () => {
		const { history } = setup( {
			sessions: [ chat( 'first', 'one' ), chat( 'second-chat', 'two' ) ],
			path: '/sessions/first',
		} );
		const recent = await screen.findByRole( 'group', { name: 'Recent' } );
		const secondSite = screen.getByRole( 'button', { name: 'Second site' } );
		expect( secondSite ).toHaveAttribute( 'aria-expanded', 'false' );
		fireEvent.click( within( recent ).getByRole( 'button', { name: 'Second-chat' } ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/second-chat' ) );
		expect( secondSite ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( within( recent ).getByRole( 'button', { name: 'Second-chat' } ) ).toHaveAttribute(
			'aria-current',
			'page'
		);
		fireEvent.click( secondSite );
		await waitFor( () => expect( secondSite ).toHaveAttribute( 'aria-expanded', 'true' ) );
	} );

	it.each( [
		{ sitePinned: false, showRecentChats: false },
		{ sitePinned: false, showRecentChats: true },
		{ sitePinned: true, showRecentChats: false },
		{ sitePinned: true, showRecentChats: true },
	] )(
		'opens a pinned chat without expanding its site (sitePinned: $sitePinned, showRecentChats: $showRecentChats)',
		async ( { sitePinned, showRecentChats } ) => {
			const { history } = setup( {
				sessions: [
					chat( 'first', 'one' ),
					chat( 'pinned-chat', 'two' ),
					chat( 'other-chat', 'two' ),
				],
				preferences: {
					sidebarPins: [ 'chat:pinned-chat', ...( sitePinned ? [ 'site:two' ] : [] ) ],
					showRecentChats,
					autoCollapseSites: true,
				},
				path: '/sessions/first',
			} );
			const pinned = await screen.findByRole( 'group', { name: 'Pinned' } );
			const firstSite = screen.getByRole( 'button', { name: 'My site' } );
			const secondSite = screen.getByRole( 'button', { name: 'Second site' } );
			await waitFor( () => expect( firstSite ).toHaveAttribute( 'aria-expanded', 'true' ) );
			expect( secondSite ).toHaveAttribute( 'aria-expanded', 'false' );
			fireEvent.click( within( pinned ).getByRole( 'button', { name: 'Pinned-chat' } ) );
			await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/pinned-chat' ) );
			expect( firstSite ).toHaveAttribute( 'aria-expanded', 'true' );
			expect( secondSite ).toHaveAttribute( 'aria-expanded', 'false' );
			expect( secondSite ).not.toHaveAttribute( 'aria-current' );
			expect( within( pinned ).getByRole( 'button', { name: 'Pinned-chat' } ) ).toHaveAttribute(
				'aria-current',
				'page'
			);
			fireEvent.click( secondSite );
			await waitFor( () => expect( secondSite ).toHaveAttribute( 'aria-expanded', 'true' ) );
			expect( firstSite ).toHaveAttribute( 'aria-expanded', 'false' );
			await act( () => history.back() );
			await waitFor( () =>
				expect( within( pinned ).getByRole( 'button', { name: 'Pinned-chat' } ) ).toHaveAttribute(
					'aria-current',
					'page'
				)
			);
			expect( secondSite ).not.toHaveAttribute( 'aria-current' );
		}
	);

	it( 'opens the next Recent chat after archiving the active chat', async () => {
		const { history } = setup( {
			sessions: [
				chat( 'newest', 'one', { updatedAt: '2026-10-26T12:00:00Z' } ),
				chat( 'current', 'one', { updatedAt: '2026-10-26T11:00:00Z' } ),
				chat( 'next', 'two', { updatedAt: '2026-10-26T10:00:00Z' } ),
			],
			path: '/sessions/current',
		} );
		const recent = await screen.findByRole( 'group', { name: 'Recent' } );
		const current = await within( recent ).findByRole( 'button', { name: 'Current' } );
		fireEvent.contextMenu( current );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Archive' } ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/next' ) );
	} );

	it.each( [ false, true ] )(
		'keeps site archives in their site (has sibling: %s)',
		async ( hasSibling ) => {
			const { history } = setup( {
				sessions: [
					...( hasSibling
						? [ chat( 'newer-sibling', 'one', { updatedAt: '2026-10-26T12:00:00Z' } ) ]
						: [] ),
					chat( 'current', 'one', { updatedAt: '2026-10-26T11:00:00Z' } ),
					chat( 'other-site', 'two', { updatedAt: '2026-10-26T10:00:00Z' } ),
					...( hasSibling
						? [ chat( 'sibling', 'one', { updatedAt: '2026-10-26T09:00:00Z' } ) ]
						: [] ),
				],
				path: '/sessions/current',
			} );
			const sites = await screen.findByRole( 'group', { name: 'Sites' } );
			const current = await within( sites ).findByRole( 'button', { name: 'Current' } );
			fireEvent.click( current );
			fireEvent.contextMenu( current );
			fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Archive' } ) );
			await waitFor( () =>
				expect( history.location.pathname ).toBe(
					hasSibling ? '/sessions/sibling' : '/sites/one/new'
				)
			);
		}
	);

	it( 'renames and archives chats from the sidebar menu without header actions', async () => {
		const { connector } = setup( {
			sites: [ makeSite( { ...site, running: true } ) ],
			sessions: [
				chat( 'rename-chat', 'one', { title: undefined, firstPrompt: 'Make the heading larger' } ),
			],
			path: '/sessions/rename-chat',
		} );
		const sites = await screen.findByRole( 'group', { name: 'Sites' } );
		fireEvent.contextMenu(
			await within( sites ).findByRole( 'button', { name: 'Make the heading larger' } )
		);
		expect( await screen.findByRole( 'menuitem', { name: 'Rename' } ) ).toBeVisible();
		expect( screen.getByRole( 'menuitem', { name: 'Archive' } ) ).toBeVisible();
		expect(
			screen
				.getAllByRole( 'menuitem' )
				.map( ( item ) => item.textContent?.replace( SHORTCUTS, '' ) )
		).toEqual( [ 'Pin', 'Rename', 'Mark as unread', 'Archive' ] );
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Rename' } ) );
		const title = await screen.findByRole( 'textbox', { name: 'Chat title' } );
		expect( title ).toHaveValue( 'Make the heading larger' );
		fireEvent.change( title, { target: { value: '  Homepage polish  ' } } );
		fireEvent.click( screen.getByRole( 'button', { name: /^Save$/ } ) );
		const renamed = await within( sites ).findByRole( 'button', { name: 'Homepage polish' } );
		expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'rename-chat', {
			title: 'Homepage polish',
		} );
		expect( screen.getByRole( 'button', { name: 'Close chat' } ) ).toBeVisible();
		fireEvent.contextMenu( renamed );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Rename' } ) );
		fireEvent.change( await screen.findByRole( 'textbox', { name: 'Chat title' } ), {
			target: { value: '' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: /^Save$/ } ) );
		const restored = await within( sites ).findByRole( 'button', {
			name: 'Make the heading larger',
		} );
		expect( screen.getByRole( 'button', { name: 'Close chat' } ) ).toBeVisible();
		fireEvent.contextMenu( restored );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Archive' } ) );
		await waitFor( () =>
			expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'rename-chat', {
				archived: true,
			} )
		);
	} );

	it( 'hides collapse all after an expanded site loses its last chat', async () => {
		const { connector, queryClient } = setup( {
			sessions: [ chat( 'second-chat', 'two' ), chat( 'only-chat', 'one' ) ],
			preferences: { autoCollapseSites: false },
		} );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Second site' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Collapse all' } ) ).toBeVisible()
		);
		connector.state.sessions = connector.state.sessions.filter(
			( session ) => session.summary.id !== 'only-chat'
		);
		await act( () => queryClient.invalidateQueries( { queryKey: [ 'sessions' ] } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'button', { name: 'Collapse all' } ) ).not.toBeInTheDocument()
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'My site' } ) );
		expect( screen.queryByRole( 'button', { name: 'Collapse all' } ) ).not.toBeInTheDocument();
	} );

	it( 'preserves sidebar groups when opening a new message from the sidebar', async () => {
		const { connector, queryClient } = setup( {
			sessions: [ chat( 'first-chat', 'one' ), chat( 'second-chat', 'two' ) ],
			preferences: { autoCollapseSites: false },
			path: '/sessions/first-chat',
		} );
		const first = await screen.findByRole( 'button', { name: 'My site' } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Second site' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Second site' } ) ).toHaveAttribute(
				'aria-current',
				'page'
			)
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'My site' } ) );
		await waitFor( () => expect( first ).toHaveAttribute( 'aria-current', 'page' ) );
		fireEvent.click( first );
		await waitFor( () => expect( first ).toHaveAttribute( 'aria-expanded', 'false' ) );
		connector.state.preferences = { ...connector.state.preferences, autoCollapseSites: true };
		await act( () => queryClient.invalidateQueries( { queryKey: [ 'user-preferences' ] } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'New chat for My site' } ) );
		expect( connector.createSession ).not.toHaveBeenCalled();
		expect( screen.getByRole( 'button', { name: 'My site' } ) ).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		expect( screen.getByRole( 'button', { name: 'Second site' } ) ).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		expect(
			await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } )
		).toBeVisible();
	} );

	it( 'keeps only the newly opened site expanded when the preference is enabled', async () => {
		setup( {
			sessions: [ chat( 'first-chat', 'one' ), chat( 'second-chat', 'two' ) ],
			preferences: { autoCollapseSites: true, sidebarPins: [ 'site:one' ] },
			path: '/sessions/first-chat',
		} );
		const first = () => screen.getByRole( 'button', { name: /^My site$/ } );
		const secondRow = () => screen.getByRole( 'button', { name: /^Second site$/ } );
		await screen.findByRole( 'button', { name: /^My site$/ } );
		fireEvent.click( secondRow() );
		await waitFor( () => expect( secondRow() ).toHaveAttribute( 'aria-expanded', 'true' ) );
		expect( first() ).toHaveAttribute( 'aria-expanded', 'false' );
		fireEvent.click( first() );
		await waitFor( () => expect( first() ).toHaveAttribute( 'aria-expanded', 'true' ) );
		expect( secondRow() ).toHaveAttribute( 'aria-expanded', 'false' );
	} );

	it( 'collapses all site sections and allows them to reopen', async () => {
		setup( {
			sessions: [ chat( 'first-chat', 'one' ), chat( 'second-chat', 'two' ) ],
			preferences: { autoCollapseSites: false },
			path: '/sessions/first-chat',
		} );
		await screen.findByRole( 'group', { name: 'My site chats' } );
		const first = screen.getByRole( 'button', { name: /^My site$/ } );
		const secondRow = screen.getByRole( 'button', { name: /^Second site$/ } );
		expect( first ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( screen.queryByRole( 'button', { name: 'Collapse all' } ) ).not.toBeInTheDocument();
		fireEvent.click( secondRow );
		await waitFor( () => expect( secondRow ).toHaveAttribute( 'aria-expanded', 'true' ) );
		expect( first ).toHaveAttribute( 'aria-expanded', 'true' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Collapse all' } ) );
		expect( first ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( secondRow ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( secondRow ).toHaveAttribute( 'aria-current', 'page' );
		expect( screen.queryByRole( 'button', { name: 'Collapse all' } ) ).not.toBeInTheDocument();
		fireEvent.click( secondRow );
		expect( secondRow ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( screen.queryByRole( 'button', { name: 'Collapse all' } ) ).not.toBeInTheDocument();
		fireEvent.click( secondRow );
		expect( screen.queryByRole( 'button', { name: 'Collapse all' } ) ).not.toBeInTheDocument();
	} );

	it( 'collapses pinned sites while keeping the heading and other sites visible', async () => {
		setup( { preferences: { sidebarPins: [ 'site:one' ] } } );
		const collapse = await screen.findByRole( 'button', { name: 'Pinned' } );
		expect( collapse ).toHaveAttribute( 'aria-expanded', 'true' );
		fireEvent.click( collapse );
		expect( collapse ).toBeVisible();
		await waitFor( () =>
			expect( screen.queryByRole( 'button', { name: 'My site' } ) ).not.toBeInTheDocument()
		);
		expect( screen.getByRole( 'button', { name: 'Second site' } ) ).toBeVisible();
		expect( localStorage.getItem( 'studio-ui-sidebar-group-pinned' ) ).toBe( 'false' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Pinned' } ) );
		expect( screen.getByRole( 'button', { name: 'My site' } ) ).toBeVisible();
		expect( localStorage.getItem( 'studio-ui-sidebar-group-pinned' ) ).toBe( 'true' );
	} );

	it( 'collapses Sites independently of Pinned and persists its state', async () => {
		setup( { preferences: { sidebarPins: [ 'site:one' ] } } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Sites' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'button', { name: 'Second site' } ) ).not.toBeInTheDocument()
		);
		expect( screen.getByRole( 'button', { name: 'My site' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Add site' } ) ).toBeVisible();
		expect( localStorage.getItem( 'studio-ui-sidebar-group-sites' ) ).toBe( 'false' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Sites' } ) );
		expect( screen.getByRole( 'button', { name: 'Second site' } ) ).toBeVisible();
		expect( localStorage.getItem( 'studio-ui-sidebar-group-sites' ) ).toBe( 'true' );
	} );

	it( 'keeps arranged site chats steady when activity changes and inserts a new chat first', async () => {
		const { connector, queryClient } = setup( {
			sites: [ site ],
			sessions: [
				chat( 'a', 'one', { title: 'Chat A', updatedAt: '2026-10-14T12:00:00Z' } ),
				chat( 'b', 'one', { title: 'Chat B', updatedAt: '2026-10-14T11:00:00Z' } ),
			],
			preferences: { sidebarChatOrder: { one: [ 'b', 'a' ] } },
			path: '/sessions/a',
		} );
		const chats = await screen.findByRole( 'group', { name: 'My site chats' } );
		const titles = () =>
			within( chats )
				.getAllByRole( 'button', { name: /^(Chat|New)/ } )
				.map( ( button ) => button.textContent );
		await waitFor( () => expect( titles() ).toEqual( [ 'Chat B', 'Chat A' ] ) );
		connector.state.sessions[ 0 ].summary.updatedAt = '2026-10-14T13:00:00Z';
		await act( () => queryClient.invalidateQueries( { queryKey: [ 'sessions' ] } ) );
		expect( titles() ).toEqual( [ 'Chat B', 'Chat A' ] );
		connector.state.sessions = [
			chat( 'new', 'one', { title: 'New chat', updatedAt: '2026-10-14T14:00:00Z' } ),
			...connector.state.sessions,
		];
		await act( () => queryClient.invalidateQueries( { queryKey: [ 'sessions' ] } ) );
		await waitFor( () => expect( titles() ).toEqual( [ 'New chat', 'Chat B', 'Chat A' ] ) );
	} );

	it( 'keeps chats in their existing groups and positions while waiting for input', async () => {
		const { connector } = setup( {
			sites: [ site ],
			sessions: [
				chat( 'first', 'one', { title: 'First chat' } ),
				chat( 'second', 'one', { title: 'Second chat' } ),
				chat( 'third', 'one', { title: 'Third chat' } ),
			],
			preferences: {
				sidebarPins: [ 'chat:first' ],
				sidebarChatOrder: { one: [ 'third', 'second' ] },
			},
			path: '/sites/one',
		} );
		const pinned = await screen.findByRole( 'group', { name: 'Pinned' } );
		const siteChats = await screen.findByRole( 'group', { name: 'My site chats' } );
		const recent = screen.getByRole( 'group', { name: 'Recent' } );
		const pinnedChat = within( pinned ).getByRole( 'button', { name: 'First chat' } );
		const siteChat = within( siteChats ).getByRole( 'button', { name: 'Second chat' } );
		const recentChat = within( recent ).getByRole( 'button', { name: 'Second chat' } );
		const chatButtons = ( element: HTMLElement ) =>
			within( element ).getAllByRole( 'button', { name: /^(First|Second|Third) chat/ } );
		const siteOrder = chatButtons( siteChats );
		const recentOrder = chatButtons( recent );
		const badge = ( element: HTMLElement ) =>
			within( element ).queryByRole( 'status', { name: 'WordPress Studio needs an answer.' } );

		emit( connector, 'first', question() );
		emit( connector, 'second', question() );
		await waitFor( () => {
			expect( badge( pinnedChat ) ).toBeVisible();
			expect( badge( siteChat ) ).toBeVisible();
			expect( badge( recentChat ) ).toBeVisible();
		} );
		expect( within( pinned ).getByRole( 'button', { name: /First chat/ } ) ).toBe( pinnedChat );
		expect( chatButtons( siteChats ) ).toEqual( siteOrder );
		expect( chatButtons( recent ) ).toEqual( recentOrder );
		expect( screen.queryByRole( 'group', { name: 'Needs input' } ) ).not.toBeInTheDocument();
		expect( connector.state.preferences.sidebarPins ).toEqual( [ 'chat:first' ] );
		expect( connector.state.preferences.sidebarChatOrder ).toEqual( {
			one: [ 'third', 'second' ],
		} );

		emit( connector, 'first', exited() );
		emit( connector, 'second', exited() );
		await waitFor( () => {
			expect( badge( pinnedChat ) ).not.toBeInTheDocument();
			expect( badge( siteChat ) ).not.toBeInTheDocument();
			expect( badge( recentChat ) ).not.toBeInTheDocument();
		} );
		expect( chatButtons( siteChats ) ).toEqual( siteOrder );
		expect( chatButtons( recent ) ).toEqual( recentOrder );
	} );

	it( 'shows a collapsed site’s pending question badge and clears it on resolution', async () => {
		const { connector } = setup( {
			sites: [ site ],
			sessions: [ chat( 'waiting', 'one', { title: 'Waiting chat' } ) ],
			path: '/sessions/waiting',
			preferences: { showRecentChats: false },
		} );
		const siteButton = await screen.findByRole( 'button', { name: 'My site' } );
		const section = within( siteButton.closest( 'li' )! );
		const badge = () =>
			section.queryByRole( 'status', { name: 'WordPress Studio needs an answer.' } );
		emit( connector, 'waiting', question() );
		await waitFor( () => expect( badge() ).toBeVisible() );
		expect(
			section.getByRole( 'button', { name: 'Waiting chat WordPress Studio needs an answer.' } )
		).toBeVisible();
		fireEvent.click( siteButton );
		await waitFor( () => expect( siteButton ).toHaveAttribute( 'aria-expanded', 'false' ) );
		const collapsedBadge = badge()!;
		expect( collapsedBadge ).toBeVisible();

		fireEvent.click( siteButton );
		await waitFor( () => expect( siteButton ).toHaveAttribute( 'aria-expanded', 'true' ) );
		expect( collapsedBadge ).not.toBeInTheDocument();
		fireEvent.click( siteButton );
		await waitFor( () => expect( badge() ).toBeVisible() );
		emit( connector, 'waiting', exited() );
		await waitFor( () => expect( badge() ).not.toBeInTheDocument() );
	} );

	it( 'shows pending question badges on site chats while retaining site startup progress', async () => {
		const { connector } = setup( {
			sites: [ site ],
			sessions: [ chat( 'starting-chat', 'one', { title: 'Starting chat' } ) ],
			path: '/sites/one',
		} );
		const siteButton = await screen.findByRole( 'button', { name: 'My site' } );
		const chatButton = await within(
			await screen.findByRole( 'group', { name: 'My site chats' } )
		).findByRole( 'button', { name: 'Starting chat' } );
		const siteSection = siteButton.closest( 'li, section' )!;
		emit( connector, 'starting-chat', {
			type: 'run.started',
			timestamp: new Date().toISOString(),
		} );
		await waitFor( () =>
			expect( within( chatButton ).getByText( 'Working…' ) ).toBeInTheDocument()
		);
		let finish!: () => void;
		connector.startSite.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					finish = resolve;
				} )
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Start My site' } ) );
		const action = await within( siteSection as HTMLElement ).findByRole( 'button', {
			name: 'Starting',
		} );
		expect( action ).toHaveAttribute( 'aria-busy', 'true' );
		expect( within( chatButton ).getByText( 'Working…' ) ).toBeInTheDocument();
		await act( async () => finish() );
		emit( connector, 'starting-chat', question() );
		await waitFor( () =>
			expect(
				within( chatButton ).getByRole( 'status', { name: 'WordPress Studio needs an answer.' } )
			).toBeVisible()
		);
		expect( screen.queryByRole( 'group', { name: 'Needs input' } ) ).not.toBeInTheDocument();
		expect( chatButton ).toBeVisible();
		const chatRow = within( chatButton.parentElement! );
		expect( chatRow.queryByRole( 'button', { name: 'Pin chat' } ) ).not.toBeInTheDocument();
		expect( chatRow.queryByRole( 'button', { name: 'Archive chat' } ) ).not.toBeInTheDocument();
		expect( within( siteButton ).queryByText( 'Needs input' ) ).not.toBeInTheDocument();
		fireEvent.click( siteButton );
		expect( within( siteButton ).queryByText( 'Needs input' ) ).not.toBeInTheDocument();
		fireEvent.click( siteButton );
		await waitFor( () =>
			expect( within( siteButton ).queryByText( 'Needs input' ) ).not.toBeInTheDocument()
		);
	} );
} );
