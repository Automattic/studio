import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getVisibleToasts, runNoticeAction } from '@/data/app-messages';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { SiteDetails } from '@/data/core';

const sites = [ 'one', 'two', 'three' ].map( ( id, sortOrder ) =>
	makeSite( { id, name: `Site ${ id }`, sortOrder } )
);

function chats( unread: string[] = [] ) {
	return [ 'a', 'b', 'c', 'd' ].map( ( id ) => ( {
		summary: makeSession( {
			id,
			title: `Chat ${ id }`,
			ownerSiteId: 'one',
			ownerSitePath: '/sites/one',
			unread: unread.includes( id ),
		} ),
		entries: [],
	} ) );
}

async function setup( {
	path = '/sites/one',
	recent = false,
	pins = [] as string[],
	unread = [] as string[],
	busy,
	extraSites = [],
}: {
	path?: string;
	recent?: boolean;
	pins?: string[];
	unread?: string[];
	busy?: { sessionId: string; phase: 'running' | 'interrupting' };
	extraSites?: SiteDetails[];
} = {} ) {
	const connector = createFakeConnector( {
		sites: [ ...sites, ...extraSites ],
		sessions: chats( unread ),
	} );
	if ( busy ) {
		connector.getActiveAgentRuns.mockResolvedValue( [
			{ ...busy, runId: 'run', startedAt: Date.now() },
		] );
	}
	connector.state.preferences.showRecentChats = recent;
	connector.state.preferences.sidebarPins = pins;
	const view = renderApp( { connector, path } );
	await waitFor( () => expect( view.history.location.pathname ).toBe( path ) );
	await screen.findByRole( 'group', { name: 'Site one chats' } );
	return view;
}

// A chat row by its id, a site row by its name.
const row = ( name: string ) =>
	screen.getAllByRole( 'button', {
		name: new RegExp( `^(Working… )?(Chat ${ name }|Site ${ name })( Unread)?$` ),
	} )[ 0 ];
const selected = () =>
	Array.from( document.querySelectorAll< HTMLElement >( '[data-selected]' ) ).map(
		( element ) => element.dataset.selectKey
	);
const select = ( ...names: string[] ) =>
	names.forEach( ( name ) => fireEvent.click( row( name ), { metaKey: true } ) );
const deleteShortcut = ( menu: HTMLElement ) =>
	fireEvent.keyDown( menu, { code: 'Backspace', key: 'Backspace', ctrlKey: true } );
async function bulkMenu( name = 'a' ) {
	fireEvent.contextMenu( row( name ) );
	return screen.findByRole( 'menu' );
}

describe( 'sidebar selection', () => {
	it( 'adds the open chat, toggles items, highlights duplicates, and clears on navigation', async () => {
		const { history } = await setup( { path: '/sessions/a', recent: true } );
		fireEvent.click( row( 'c' ), { metaKey: true } );
		expect( selected().sort() ).toEqual( [ 'chat:a', 'chat:a', 'chat:c', 'chat:c' ] );
		expect( history.location.pathname ).toBe( '/sessions/a' );
		fireEvent.click( row( 'a' ), { ctrlKey: true } );
		expect( selected() ).toEqual( [ 'chat:c', 'chat:c' ] );
		fireEvent.click( row( 'b' ) );
		expect( selected() ).toEqual( [] );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/b' ) );
	} );

	it( 'extends selections across item types and scopes select-all to rendered rows', async () => {
		await setup();
		fireEvent.click( row( 'a' ), { metaKey: true } );
		fireEvent.click( row( 'c' ), { shiftKey: true } );
		expect( selected() ).toEqual( [ 'chat:a', 'chat:b', 'chat:c' ] );
		fireEvent.click( row( 'two' ), { metaKey: true } );
		expect( selected() ).toEqual( [ 'chat:a', 'chat:b', 'chat:c', 'site:two' ] );
		fireEvent.keyDown( row( 'a' ), { key: 'a', ctrlKey: true } );
		expect( screen.getByText( '4 chats selected' ) ).toHaveAttribute( 'role', 'status' );
		fireEvent.keyDown( row( 'a' ), { key: 'Escape' } );
		fireEvent.click( row( 'b' ), { metaKey: true } );
		fireEvent.click( row( 'b' ), { metaKey: true } );
		fireEvent.click( row( 'two' ), { shiftKey: true } );
		expect( selected() ).toEqual( [ 'chat:b', 'chat:c', 'chat:d', 'site:two' ] );
	} );

	it( 'selects only the focused site chat list without adding other Recent chats', async () => {
		await setup( { recent: true } );
		const siteChats = screen.getByRole( 'group', { name: 'Site one chats' } );
		const recent = screen.getByRole( 'group', { name: 'Recent' } );
		fireEvent.keyDown( within( siteChats ).getByRole( 'button', { name: 'Chat a' } ), {
			key: 'a',
			metaKey: true,
		} );
		expect( siteChats.querySelectorAll( '[data-selected]' ) ).toHaveLength( 4 );
		expect( recent.querySelectorAll( '[data-selected]' ) ).toHaveLength( 4 );
		expect( row( 'one' ).closest( '[data-selected]' ) ).toBeNull();
		fireEvent.keyDown( row( 'one' ), { key: 'a', metaKey: true } );
		expect( selected() ).toContain( 'site:one' );
		expect( selected() ).toContain( 'site:three' );
	} );

	it( 'supports keyboard ranges and leaves editable select-all alone', async () => {
		await setup();
		row( 'a' ).focus();
		fireEvent.keyDown( row( 'a' ), { key: 'ArrowDown', shiftKey: true } );
		expect( row( 'b' ) ).toHaveFocus();
		expect( selected() ).toEqual( [ 'chat:a', 'chat:b' ] );
		fireEvent.keyDown( row( 'b' ), { key: 'F2' } );
		const name = await screen.findByRole( 'textbox' );
		fireEvent.keyDown( name, { key: 'a', metaKey: true } );
		expect( selected() ).toEqual( [ 'chat:a', 'chat:b' ] );
	} );

	it( 'preserves bulk right-click and clears it when right-clicking an unselected item', async () => {
		await setup( { unread: [ 'a' ] } );
		fireEvent.click( row( 'a' ), { metaKey: true } );
		fireEvent.click( row( 'b' ), { metaKey: true } );
		const menu = await bulkMenu();
		expect( within( menu ).queryByText( /selected/ ) ).not.toBeInTheDocument();
		expect(
			within( menu )
				.getAllByRole( 'menuitem' )
				.map( ( item ) => item.textContent?.replace( /Ctrl\+Alt\+P|Ctrl\+Shift\+A|⌥⌘P|⇧⌘A/g, '' ) )
		).toEqual( [ 'Mark as read', 'Mark as unread', 'Pin', 'Unpin', 'Archive 2 chats' ] );
		expect( within( menu ).queryByRole( 'menuitem', { name: /Rename/ } ) ).not.toBeInTheDocument();
		fireEvent.keyDown( menu, { key: 'Escape' } );
		fireEvent.contextMenu( row( 'c' ) );
		expect( await screen.findByRole( 'menuitem', { name: /Rename/ } ) ).toBeVisible();
		expect( selected() ).toEqual( [] );
	} );

	it.each( [ 'chats', 'sites', 'mixed' ] as const )(
		'pins and unpins %s with explicit target states and the bulk shortcut',
		async ( kind ) => {
			const initial = [ 'chat:a', 'chat:d', 'site:one', 'site:three' ];
			const { connector } = await setup( { pins: initial } );
			const targets =
				kind === 'chats'
					? [ 'a', 'b' ]
					: kind === 'sites'
					? [ 'one', 'two' ]
					: [ 'a', 'b', 'one', 'two' ];
			select( ...targets );
			let menu = await bulkMenu( targets[ 0 ] );
			expect( within( menu ).getByRole( 'menuitem', { name: /^Unpin/ } ) ).not.toHaveAttribute(
				'aria-disabled'
			);
			fireEvent.click( within( menu ).getByRole( 'menuitem', { name: /^Pin/ } ) );
			await waitFor( () => expect( selected() ).toEqual( [] ) );
			const added = { chats: [ 'chat:b' ], sites: [ 'site:two' ], mixed: [ 'chat:b', 'site:two' ] }[
				kind
			];
			await waitFor( () =>
				expect( connector.state.preferences.sidebarPins ).toEqual( [ ...initial, ...added ] )
			);
			select( ...targets );
			menu = await bulkMenu( targets[ 0 ] );
			expect( within( menu ).getByRole( 'menuitem', { name: /^Pin/ } ) ).toHaveAttribute(
				'aria-disabled',
				'true'
			);
			fireEvent.keyDown( menu, { code: 'KeyP', key: 'p', ctrlKey: true, altKey: true } );
			await waitFor( () => expect( selected() ).toEqual( [] ) );
			const removed = new Set(
				targets.map( ( id ) => ( id.length === 1 ? `chat:${ id }` : `site:${ id }` ) )
			);
			await waitFor( () =>
				expect( connector.state.preferences.sidebarPins ).toEqual(
					initial.filter( ( key ) => ! removed.has( key ) )
				)
			);
			expect( connector.updateSessionMetadata ).not.toHaveBeenCalled();
			expect( connector.deleteSite ).not.toHaveBeenCalled();
		}
	);

	it( 'sets read state across mixed selections once per ID', async () => {
		const { connector } = await setup( { unread: [ 'a' ] } );
		select( 'a', 'b', 'two' );
		const menu = await bulkMenu();
		fireEvent.click( within( menu ).getByRole( 'menuitem', { name: 'Mark as read' } ) );
		await waitFor( () => expect( connector.updateSessionMetadata ).toHaveBeenCalledTimes( 2 ) );
		expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'a', { unread: false } );
		expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'b', { unread: false } );
		await waitFor( () => expect( selected() ).toEqual( [ 'site:two' ] ) );
	} );

	it( 'archives the open chat and offers to undo only the successes', async () => {
		const { connector, history } = await setup( { path: '/sessions/a' } );
		connector.updateSessionMetadata.mockImplementation( async ( id, patch ) => {
			if ( id === 'b' && patch.archived ) {
				throw new Error( 'Failed b' );
			}
			return makeSession( { id, ...patch } );
		} );
		select( 'b', 'two' );
		const menu = await bulkMenu();
		fireEvent.click( within( menu ).getByRole( 'menuitem', { name: /Archive/ } ) );
		await waitFor( () => expect( getVisibleToasts() ).toHaveLength( 1 ) );
		expect( selected() ).toEqual( [ 'chat:b', 'site:two' ] );
		await waitFor( () => expect( history.location.pathname ).not.toBe( '/sessions/a' ) );
		const left = history.location.pathname;
		const notice = getVisibleToasts()[ 0 ];
		expect( notice.action?.label ).toBe( 'Undo' );
		await act( async () => {
			expect( await runNoticeAction( notice.action! ) ).toBe( true );
		} );
		expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'a', { archived: false } );
		expect( connector.updateSessionMetadata ).not.toHaveBeenCalledWith( 'b', { archived: false } );
		expect( selected() ).toEqual( [ 'chat:b', 'site:two' ] );
		expect( history.location.pathname ).toBe( left );
	} );

	it( 'undoes a bulk archive without reopening the archived chat', async () => {
		const { connector, history } = await setup( { path: '/sessions/a' } );
		select( 'b', 'two' );
		const menu = await bulkMenu();
		fireEvent.click( within( menu ).getByRole( 'menuitem', { name: 'Archive 2 chats' } ) );
		await waitFor( () =>
			expect( getVisibleToasts().map( ( toast ) => toast.title ) ).toContain( '2 chats archived' )
		);
		expect( selected() ).toEqual( [ 'site:two' ] );
		await waitFor( () => expect( history.location.pathname ).not.toBe( '/sessions/a' ) );
		const left = history.location.pathname;
		const notice = getVisibleToasts().find( ( toast ) => toast.title === '2 chats archived' )!;
		await act( async () => {
			expect( await runNoticeAction( notice.action! ) ).toBe( true );
		} );
		expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'a', { archived: false } );
		expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'b', { archived: false } );
		expect( selected() ).toEqual( [ 'site:two' ] );
		expect( history.location.pathname ).toBe( left );
	} );

	it.each( [ 'interrupting', 'running' ] as const )(
		'blocks archive while a selected chat is %s',
		async ( phase ) => {
			const { connector } = await setup( { busy: { sessionId: 'b', phase } } );
			select( 'a', 'b' );
			const menu = await bulkMenu();
			await waitFor( () =>
				expect( within( menu ).getByRole( 'menuitem', { name: /Archive/ } ) ).toHaveAttribute(
					'aria-disabled',
					'true'
				)
			);
			expect( within( menu ).getByText( /Wait for active chats/ ) ).toBeVisible();
			expect( connector.updateSessionMetadata ).not.toHaveBeenCalled();
		}
	);

	it( 'archives only chats in a mixed selection, and deletes the sites separately', async () => {
		const { connector } = await setup();
		select( 'a', 'b', 'one', 'two' );
		let menu = await bulkMenu();
		expect( within( menu ).getByRole( 'menuitem', { name: /Archive 2 chats/ } ) ).toBeVisible();
		expect( within( menu ).getByRole( 'menuitem', { name: /Delete 2 sites/ } ) ).toBeVisible();
		fireEvent.click( within( menu ).getByRole( 'menuitem', { name: /Archive 2 chats/ } ) );
		await waitFor( () => expect( selected() ).toEqual( [ 'site:one', 'site:two' ] ) );
		expect( connector.deleteSite ).not.toHaveBeenCalled();
		expect( connector.updateSessionMetadata ).toHaveBeenCalledTimes( 2 );
		menu = await bulkMenu( 'one' );
		expect( within( menu ).getAllByRole( 'menuitem' ) ).toHaveLength( 3 );
		fireEvent.click( within( menu ).getByRole( 'menuitem', { name: /Delete 2 sites/ } ) );
		const dialog = await screen.findByRole( 'alertdialog' );
		expect( dialog ).toHaveAccessibleName( 'Remove 2 sites from WordPress Studio?' );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Remove sites' } ) );
		await waitFor( () => expect( selected() ).toEqual( [] ) );
		expect( connector.deleteSite ).toHaveBeenCalledWith( 'one', false );
		expect( connector.deleteSite ).toHaveBeenCalledWith( 'two', false );
	} );

	it( 'opens the site confirmation from the bulk delete shortcut without deleting chats or sites', async () => {
		const { connector } = await setup();
		select( 'a', 'one', 'two' );
		deleteShortcut( await bulkMenu() );
		const dialog = await screen.findByRole( 'alertdialog' );
		expect( dialog ).toHaveAccessibleName( 'Remove 2 sites from WordPress Studio?' );
		expect( within( dialog ).getByRole( 'checkbox' ) ).not.toBeChecked();
		expect( connector.deleteSite ).not.toHaveBeenCalled();
		expect( connector.updateSessionMetadata ).not.toHaveBeenCalled();
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Cancel' } ) );
		expect( selected() ).toContain( 'chat:a' );
		expect( selected() ).toContain( 'site:one' );
	} );

	it( 'keeps archive and deletion eligibility separate in mixed selections', async () => {
		await setup( { busy: { sessionId: 'b', phase: 'running' } } );
		select( 'c', 'one' );
		const menu = await bulkMenu( 'c' );
		await waitFor( () =>
			expect( within( menu ).getByRole( 'menuitem', { name: /Delete 1 site/ } ) ).toHaveAttribute(
				'aria-disabled',
				'true'
			)
		);
		expect(
			within( menu ).getByRole( 'menuitem', { name: /Archive 1 chat/ } )
		).not.toHaveAttribute( 'aria-disabled' );
	} );

	it( 'distinguishes chat and site IDs with the same value', async () => {
		const { connector } = await setup( {
			extraSites: [ makeSite( { id: 'a', name: 'Site a', sortOrder: 3 } ) ],
		} );
		const chat = screen.getAllByRole( 'button', { name: 'Chat a' } )[ 0 ];
		const site = screen.getByRole( 'button', { name: 'Site a' } );
		fireEvent.click( chat, { metaKey: true } );
		fireEvent.click( site, { metaKey: true } );
		fireEvent.contextMenu( chat );
		const menu = await screen.findByRole( 'menu' );
		expect( within( menu ).getByRole( 'menuitem', { name: /Delete 1 site/ } ) ).toBeVisible();
		fireEvent.click( within( menu ).getByRole( 'menuitem', { name: /Archive 1 chat/ } ) );
		await waitFor( () =>
			expect( connector.updateSessionMetadata ).toHaveBeenCalledExactlyOnceWith( 'a', {
				archived: true,
			} )
		);
		await waitFor( () => expect( selected() ).toEqual( [ 'site:a' ] ) );
		expect( connector.deleteSite ).not.toHaveBeenCalled();
	} );

	it( 'blocks site removal for busy chat work and prunes removed sites', async () => {
		const { connector, queryClient } = await setup( {
			busy: { sessionId: 'b', phase: 'running' },
		} );
		select( 'one', 'two' );
		const menu = await bulkMenu( 'one' );
		await waitFor( () =>
			expect( within( menu ).getByRole( 'menuitem', { name: /Delete 2 sites/ } ) ).toHaveAttribute(
				'aria-disabled',
				'true'
			)
		);
		deleteShortcut( menu );
		expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument();
		connector.state.sites = connector.state.sites.filter( ( entry ) => entry.id !== 'one' );
		await act( () => queryClient.invalidateQueries( { queryKey: [ 'sites' ] } ) );
		await waitFor( () => expect( selected() ).toEqual( [ 'site:two' ] ) );
	} );

	it.each( [ false, true ] )(
		'confirms sequential site removal with deleteFiles=%s',
		async ( files ) => {
			const { connector } = await setup();
			let finish: () => void = () => {};
			connector.deleteSite.mockImplementationOnce(
				() =>
					new Promise( ( resolve ) => {
						finish = resolve;
					} )
			);
			select( 'one', 'two' );
			const menu = await bulkMenu( 'one' );
			fireEvent.click( within( menu ).getByRole( 'menuitem', { name: /Delete 2 sites/ } ) );
			const dialog = await screen.findByRole( 'alertdialog' );
			expect( within( dialog ).getByRole( 'checkbox' ) ).not.toBeChecked();
			if ( files ) {
				fireEvent.click( within( dialog ).getByRole( 'checkbox' ) );
			}
			fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Remove sites' } ) );
			await waitFor( () => expect( connector.deleteSite ).toHaveBeenCalledTimes( 1 ) );
			await act( async () => finish() );
			await waitFor( () => expect( connector.deleteSite ).toHaveBeenCalledTimes( 2 ) );
			expect( connector.deleteSite ).toHaveBeenNthCalledWith( 1, 'one', files );
			expect( connector.deleteSite ).toHaveBeenNthCalledWith( 2, 'two', files );
		}
	);
} );
