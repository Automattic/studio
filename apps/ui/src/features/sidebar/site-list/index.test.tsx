import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberVisit } from '@/features/sidebar/last-visited';
import {
	createFakeConnector,
	makeSession,
	makeSite,
	TEST_USER,
	type FakeConnectorInitialState,
} from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { SyncActivity } from '@/data/sync-activity';

const mySite = makeSite( { id: 'one', name: 'My site', path: '/sites/my-site' } );
const runningSite = makeSite( {
	id: 'two',
	name: 'Running site',
	path: '/sites/running',
	running: true,
} );

function chat( id: string, updatedAt: string, archived?: boolean ) {
	return {
		summary: makeSession( {
			id,
			firstPrompt: `Prompt of ${ id }`,
			ownerSiteId: 'one',
			ownerSitePath: '/sites/my-site',
			updatedAt,
			archived,
		} ),
		entries: [],
	};
}

async function setup( {
	path = '/sites/two',
	...state
}: FakeConnectorInitialState & { path?: string } = {} ) {
	const connector = createFakeConnector( {
		sites: [ mySite, runningSite ],
		...state,
		preferences: { autoCollapseSites: false, ...state.preferences },
	} );
	return settled( renderApp( { connector, path } ), path );
}

async function settled< T extends ReturnType< typeof renderApp > >( view: T, path: string ) {
	await waitFor( () => expect( view.history.location.pathname ).toBe( path ) );
	await screen.findByRole( 'button', { name: /^Site actions for / } );
	return view;
}

const siteButton = async ( name: string ) =>
	within( await screen.findByRole( 'group', { name: 'Sites' } ) ).findByRole( 'button', { name } );
const siteRow = async ( name: string ) => ( await siteButton( name ) ).closest( 'li' )!;

async function openIn( name: string ) {
	fireEvent.contextMenu( await siteButton( name ) );
	fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Open in' } ) );
}

function pointer( type: string, clientY: number ) {
	const event = new MouseEvent( type, { bubbles: true, cancelable: true, clientX: 16, clientY } );
	Object.defineProperty( event, 'pointerId', { value: 1 } );
	return event;
}

function stackRows( buttons: HTMLElement[] ) {
	return buttons.map( ( button, index ) => {
		const row = button.closest< HTMLElement >( '[data-reorder-id]' )!;
		vi.spyOn( row, 'getBoundingClientRect' ).mockReturnValue(
			new DOMRect( 8, index * 35, 272, 34 )
		);
		return row;
	} );
}

function drag( row: HTMLElement, toY: number ) {
	fireEvent( row, pointer( 'pointerdown', 10 ) );
	fireEvent( window, pointer( 'pointermove', toY ) );
}

beforeEach( () => localStorage.clear() );

describe( 'sidebar site list', () => {
	it( 'records Tracks for the Open in destinations, opening admin pages through the host', async () => {
		const { connector } = await setup();
		await openIn( 'My site' );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Finder' } ) );
		await waitFor( () => expect( connector.openSiteFolder ).toHaveBeenCalledWith( 'one' ) );
		expect( connector.trackEvent ).toHaveBeenCalledWith( 'studio_site_open_folder' );

		await openIn( 'Running site' );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'phpMyAdmin' } ) );
		await openIn( 'Running site' );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Browser (WP Admin)' } ) );
		await waitFor( () =>
			expect( connector.openSiteUrl ).toHaveBeenCalledWith( 'two', '/wp-admin/' )
		);
		expect( connector.openSiteUrl ).toHaveBeenCalledWith(
			'two',
			'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
		);
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
		expect( connector.trackEvent ).toHaveBeenCalledWith( 'studio_site_open_phpmyadmin', {
			browser: 'external',
		} );
		expect( connector.trackEvent ).toHaveBeenCalledWith( 'studio_site_open_wp_admin', {
			browser: 'external',
		} );
	} );

	it( 'names the configured editor and terminal in Open in', async () => {
		const { connector } = await setup( { preferences: { editor: 'zed', terminal: 'terminal' } } );
		await openIn( 'My site' );
		expect( await screen.findByRole( 'menuitem', { name: 'Terminal' } ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Zed' } ) );
		await waitFor( () => expect( connector.openSiteInEditor ).toHaveBeenCalledWith( 'one' ) );
	} );

	it( 'records the settings panel when site settings open from the row menu', async () => {
		const { connector, history } = await setup();
		fireEvent.contextMenu( await siteButton( 'My site' ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Settings' } ) );
		await waitFor( () => expect( history.location.search ).toContain( 'settingsSite=one' ) );
		expect( connector.trackEvent ).toHaveBeenCalledWith( 'studio_panel_opened', {
			panel: 'settings',
		} );
	} );

	it.each( [ true, false ] )(
		'opens a new chat for a site without chats and records the assistant panel (signed in: %s)',
		async ( signedIn ) => {
			const { connector, history } = await setup( {
				user: signedIn ? TEST_USER : null,
				sessions: [ chat( 'archived', '2026-06-01T00:00:00.000Z', true ) ],
			} );
			fireEvent.click( await siteButton( 'My site' ) );
			await waitFor( () => expect( history.location.pathname ).not.toBe( '/sites/two' ) );
			expect( history.location.pathname ).not.toBe( '/sessions/archived' );
			expect( connector.trackEvent ).toHaveBeenCalledWith( 'studio_panel_opened', {
				panel: 'assistant',
			} );
		}
	);

	it( 'opens the site draft even when it has recent or previously visited chats', async () => {
		const sessions = [
			chat( 'older', '2026-06-01T12:00:00.000Z' ),
			chat( 'latest', '2026-06-20T12:00:00.000Z' ),
		];
		const { history, unmount } = await setup( { sessions, path: '/sites/two' } );
		fireEvent.click( await siteButton( 'My site' ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one/new' ) );
		unmount();

		rememberVisit( 'one', 'older' );
		const view = await setup( { sessions, path: '/sites/two' } );
		fireEvent.click( await siteButton( 'My site' ) );
		await waitFor( () => expect( view.history.location.pathname ).toBe( '/sites/one/new' ) );
	} );

	it( 'lists sites while chats are still loading', async () => {
		const connector = createFakeConnector( { sites: [ mySite ] } );
		connector.getSessions.mockReturnValue( new Promise( () => {} ) );
		renderApp( { connector } );
		expect( await siteButton( 'My site' ) ).toBeVisible();
	} );

	it( 'offers to retry when chats fail to reload', async () => {
		const { connector, queryClient } = await setup( {
			sessions: [ chat( 'latest', '2026-06-20T12:00:00.000Z' ) ],
			path: '/sites/one',
		} );
		await screen.findAllByRole( 'button', { name: /Prompt of latest/ } );
		const getSessions = connector.getSessions.getMockImplementation()!;
		connector.getSessions.mockRejectedValue( new Error( 'Unavailable' ) );
		await act( () => queryClient.invalidateQueries( { queryKey: [ 'sessions' ], exact: true } ) );
		const [ retry ] = await screen.findAllByRole( 'button', { name: 'Retry loading chats' } );
		connector.getSessions.mockImplementation( getSessions );
		fireEvent.click( retry );
		await waitFor( () =>
			expect(
				screen.queryByRole( 'button', { name: 'Retry loading chats' } )
			).not.toBeInTheDocument()
		);
		expect( screen.getAllByRole( 'button', { name: /Prompt of latest/ } )[ 0 ] ).toBeVisible();
	} );

	it( 'folds a dragged site, and moves nothing when it is dropped outside its group', async () => {
		const { connector } = await setup( {
			sessions: [ chat( 'latest', '2026-06-20T12:00:00.000Z' ) ],
			path: '/sites/one',
		} );
		const site = await siteButton( 'My site' );
		await waitFor( () => expect( site ).toHaveAttribute( 'aria-expanded', 'true' ) );
		const [ row, running ] = stackRows( [ site, await siteButton( 'Running site' ) ] );

		drag( row, 200 );
		expect( site ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( running ).not.toHaveAttribute( 'data-drop-position' );
		fireEvent( window, pointer( 'pointerup', 200 ) );

		expect( connector.updateSitesSortOrder ).not.toHaveBeenCalled();
		expect( site ).toHaveAttribute( 'aria-expanded', 'false' );
	} );

	it( 'shows a dropped chat in its new slot before the order is saved', async () => {
		const { connector } = await setup( {
			sessions: [
				chat( 'older', '2026-06-01T12:00:00.000Z' ),
				chat( 'latest', '2026-06-20T12:00:00.000Z' ),
			],
			path: '/sites/one',
		} );
		const chats = await screen.findByRole( 'group', { name: 'My site chats' } );
		const titles = () =>
			within( chats )
				.getAllByRole( 'button', { name: /^Prompt of / } )
				.map( ( button ) => button.textContent );
		await waitFor( () => expect( titles() ).toEqual( [ 'Prompt of latest', 'Prompt of older' ] ) );
		const [ latest, older ] = stackRows(
			within( chats ).getAllByRole( 'button', { name: /^Prompt of / } )
		);

		drag( latest, 60 );
		expect( older ).toHaveAttribute( 'data-drop-position', 'after' );
		fireEvent( window, pointer( 'pointerup', 60 ) );

		expect( titles() ).toEqual( [ 'Prompt of older', 'Prompt of latest' ] );
		await waitFor( () =>
			expect( connector.setUserPreferences ).toHaveBeenCalledWith(
				{ sidebarChatOrder: { one: [ 'older', 'latest' ] } },
				undefined
			)
		);
	} );

	it( 'shows the Xdebug glyph in place of the site icon', async () => {
		await setup( { sites: [ { ...mySite, enableXdebug: true }, runningSite ] } );
		expect(
			within( await siteRow( 'My site' ) ).getByRole( 'img', { name: 'Xdebug enabled' } )
		).toBeInTheDocument();
		expect(
			within( await siteRow( 'Running site' ) ).queryByRole( 'img', { name: 'Xdebug enabled' } )
		).not.toBeInTheDocument();
	} );

	it.each( [
		[ { kind: 'pending', direction: 'import' }, 'Importing backup' ],
		[ { kind: 'pending', direction: 'push', phase: 'uploading' }, 'Syncing live site' ],
	] as [ SyncActivity, string ][] )(
		'shows %o activity on that site row only, before its name',
		async ( activity, label ) => {
			const { connector } = await setup();
			await siteButton( 'My site' );
			act( () => connector.emit( 'onSyncActivity', { siteId: 'two', activity } ) );
			const row = await siteRow( 'Running site' );
			const indicator = await within( row ).findByRole( 'status', { name: label } );
			expect(
				indicator.compareDocumentPosition( await siteButton( 'Running site' ) ) &
					Node.DOCUMENT_POSITION_FOLLOWING
			).toBeTruthy();
			expect(
				within( await siteRow( 'My site' ) ).queryByRole( 'status' )
			).not.toBeInTheDocument();
		}
	);
} );
