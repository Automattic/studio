import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import styles from './style.module.css';

const sites = [
	makeSite( { id: 'one', name: 'My site' } ),
	makeSite( { id: 'two', name: 'Other site' } ),
];

const originalWidth = window.innerWidth;

async function setup( width = 1280, sessions: ReturnType< typeof makeSession >[] = [] ) {
	Object.defineProperty( window, 'innerWidth', { configurable: true, value: width } );
	localStorage.setItem( 'studio-ui-sidebar-collapsed', 'true' );
	const view = renderApp( {
		connector: createFakeConnector( {
			sites,
			user: null,
			sessions: sessions.map( ( summary ) => ( { summary, entries: [] } ) ),
		} ),
		path: '/sites/one',
	} );
	const trigger = await waitFor( () => {
		const button = screen
			.getAllByRole( 'button', { name: 'Show sidebar' } )
			.find( ( candidate ) => ! candidate.closest( '[inert]' ) );
		expect( button ).toBeDefined();
		return button!;
	} );
	const edge = () => view.container.querySelector< HTMLElement >( `.${ styles.sidebarEdge }` )!;
	const open = async () => {
		await view.user.hover( edge() );
		await screen.findByRole( 'button', { name: 'Close sidebar' } );
		return within( screen.getByRole( 'dialog', { name: 'Sidebar' } ) ).getByRole( 'complementary', {
			name: '',
		} );
	};
	return { ...view, trigger, edge, open };
}

const switcherClosed = () =>
	waitFor( () =>
		expect( screen.queryByRole( 'button', { name: 'Close sidebar' } ) ).not.toBeInTheDocument()
	);

beforeEach( () => {
	localStorage.clear();
} );
afterEach( () => {
	vi.restoreAllMocks();
	document.documentElement.style.removeProperty( '--motion-duration-layout' );
	Object.defineProperty( window, 'innerWidth', { configurable: true, value: originalWidth } );
} );

describe( 'sidebar hover overlay', () => {
	it( 'keeps the flyout open while toggling sites and closes when a chat opens', async () => {
		const { connector, history, open } = await setup( 1280, [
			makeSession( {
				id: 'flyout-chat',
				title: 'Saved flyout chat',
				ownerSiteId: 'two',
				ownerSitePath: sites[ 1 ].path,
			} ),
		] );
		const switcher = await open();
		fireEvent.click( await within( switcher ).findByRole( 'button', { name: /^Other site/ } ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two/new' ) );
		expect( screen.getByRole( 'dialog', { name: 'Sidebar' } ) ).toBeVisible();
		const site = within( switcher ).getByRole( 'button', { name: /^Other site/ } );
		expect( site ).toHaveAttribute( 'aria-expanded', 'true' );
		fireEvent.click( site );
		expect( site ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( screen.getByRole( 'dialog', { name: 'Sidebar' } ) ).toBeVisible();
		fireEvent.click( site );
		fireEvent.click(
			within(
				await within( switcher ).findByRole( 'group', { name: 'Other site chats' } )
			).getByRole( 'button', { name: 'Saved flyout chat' } )
		);
		await switcherClosed();
		expect( connector.createSession ).not.toHaveBeenCalled();
	} );

	it( 'closes on Escape, and leaves Escape alone while closed', async () => {
		const { trigger, open } = await setup();
		const switcher = await open();
		fireEvent.keyDown( switcher, { key: 'Escape' } );
		await switcherClosed();
		expect( fireEvent.keyDown( trigger, { key: 'Escape' } ) ).toBe( true );
	} );

	it( 'keeps the sidebar scroll position when the hovered toggle is clicked', async () => {
		const { trigger, open } = await setup();
		const sidebar = await open();
		const flyout = sidebar.closest( '[role="dialog"]' )!;
		const scrollport = sidebar.querySelector< HTMLElement >( `.${ styles.sidebarScroll }` )!;
		scrollport.scrollTop = 120;
		document.documentElement.style.setProperty( '--motion-duration-layout', '320ms' );
		fireEvent.click( trigger );
		expect( flyout ).not.toBeInTheDocument();
		expect(
			await screen.findByRole( 'separator', { name: 'Resize sidebar' } )
		).toBeInTheDocument();
		expect( screen.queryByRole( 'dialog', { name: 'Sidebar' } ) ).not.toBeInTheDocument();
		expect( document.activeElement ).toHaveAccessibleName( 'Hide sidebar' );
		expect(
			screen
				.getByRole( 'complementary', { name: '' } )
				.querySelector( `.${ styles.sidebarScroll }` )?.scrollTop
		).toBe( 120 );
	} );
} );

it( 'keeps focus and the saved preference while peeking, then closes on leave', async () => {
	const { trigger, open, user } = await setup();
	trigger.focus();
	const sidebar = await open();
	expect( trigger ).toHaveFocus();
	expect( trigger ).toHaveAttribute( 'aria-expanded', 'true' );
	expect( localStorage.getItem( 'studio-ui-sidebar-collapsed' ) ).toBe( 'true' );
	expect( screen.queryByRole( 'separator', { name: 'Resize sidebar' } ) ).not.toBeInTheDocument();
	await user.unhover( trigger );
	await user.hover( sidebar );
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 400 ) );
	} );
	expect( screen.getByRole( 'button', { name: 'Close sidebar' } ) ).toBeInTheDocument();
	await user.unhover( sidebar );
	await switcherClosed();
} );

it( 'reveals the sidebar only when the mouse crosses its window edge below the header', async () => {
	const { trigger, edge, user } = await setup();
	vi.spyOn( edge(), 'getBoundingClientRect' ).mockReturnValue( new DOMRect( 0, 44, 6, 600 ) );
	const leave = ( clientX: number, clientY: number ) =>
		fireEvent(
			trigger,
			Object.assign( new MouseEvent( 'pointerout', { bubbles: true, clientX, clientY } ), {
				pointerType: 'mouse',
			} )
		);
	leave( window.innerWidth + 25, 180 );
	expect( screen.queryByRole( 'dialog', { name: 'Sidebar' } ) ).not.toBeInTheDocument();
	leave( -25, 43 );
	expect( screen.queryByRole( 'dialog', { name: 'Sidebar' } ) ).not.toBeInTheDocument();
	leave( -25, 44 );
	expect( await screen.findByRole( 'dialog', { name: 'Sidebar' } ) ).toBeVisible();
	expect( trigger ).toHaveAttribute( 'aria-expanded', 'true' );
	fireEvent.pointerMove( screen.getByRole( 'main' ), { clientX: 600, clientY: 180 } );
	await switcherClosed();
	leave( -25, 44 );
	expect( trigger ).toHaveAttribute( 'aria-expanded', 'true' );
	await switcherClosed();
	leave( -25, 44 );
	const sidebar = within( await screen.findByRole( 'dialog', { name: 'Sidebar' } ) ).getByRole(
		'complementary'
	);
	await user.hover( sidebar );
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 400 ) );
	} );
	expect( trigger ).toHaveAttribute( 'aria-expanded', 'true' );
	await user.unhover( sidebar );
	await switcherClosed();
} );

it( 'peeks when the pointer reaches the edge immediately after hiding the sidebar', async () => {
	const { trigger, edge, user } = await setup();
	fireEvent.click( trigger );
	const hide = screen
		.getAllByRole( 'button', { name: 'Hide sidebar' } )
		.find( ( button ) => ! button.closest( '[inert]' ) )!;
	fireEvent.click( hide );
	await user.hover( edge() );
	expect( await screen.findByRole( 'dialog', { name: 'Sidebar' } ) ).toBeVisible();
} );

it( 'supports mouse hover on a device with touch', async () => {
	const matchMedia = window.matchMedia;
	vi.spyOn( window, 'matchMedia' ).mockImplementation( ( query ) => ( {
		...matchMedia( query ),
		matches: query === '(any-pointer: coarse)',
	} ) );
	const { edge } = await setup();
	vi.spyOn( edge(), 'getBoundingClientRect' ).mockReturnValue( new DOMRect( 0, 44, 6, 600 ) );
	const move = ( clientX: number ) =>
		fireEvent(
			screen.getByRole( 'main' ),
			Object.assign( new MouseEvent( 'pointermove', { bubbles: true, clientX, clientY: 180 } ), {
				pointerType: 'mouse',
			} )
		);
	move( 3 );
	expect( await screen.findByRole( 'dialog', { name: 'Sidebar' } ) ).toBeVisible();
	move( 300 );
	await switcherClosed();
} );

it( 'ignores touch hover and cancels a brief pointer pass', async () => {
	const { edge, user } = await setup();
	fireEvent.pointerEnter( edge(), { pointerType: 'touch' } );
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 220 ) );
	} );
	expect( screen.queryByRole( 'button', { name: 'Close sidebar' } ) ).not.toBeInTheDocument();
	await user.hover( edge() );
	await user.unhover( edge() );
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 220 ) );
	} );
	expect( screen.queryByRole( 'button', { name: 'Close sidebar' } ) ).not.toBeInTheDocument();
} );

it( 'keeps the flyout closed while the pointer rests on the toggle', async () => {
	const { trigger, user } = await setup();
	fireEvent.click( trigger );
	const hide = screen
		.getAllByRole( 'button', { name: 'Hide sidebar' } )
		.find( ( button ) => ! button.closest( '[inert]' ) )!;
	fireEvent.click( hide );
	const show = screen
		.getAllByRole( 'button', { name: 'Show sidebar' } )
		.find( ( button ) => ! button.closest( '[inert]' ) )!;
	await user.hover( show );
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 220 ) );
	} );
	expect( screen.queryByRole( 'dialog', { name: 'Sidebar' } ) ).not.toBeInTheDocument();
} );

it( 'allows multi-selection inside the flyover without navigating', async () => {
	const { open, history } = await setup();
	const sidebar = await open();
	const first = within( sidebar ).getByRole( 'button', { name: 'My site' } );
	const second = within( sidebar ).getByRole( 'button', { name: 'Other site' } );
	const path = history.location.pathname;
	fireEvent.click( first, { ctrlKey: true } );
	fireEvent.click( second, { ctrlKey: true } );
	expect( first ).toHaveAttribute( 'aria-pressed', 'true' );
	expect( second ).toHaveAttribute( 'aria-pressed', 'true' );
	expect( history.location.pathname ).toBe( path );
	fireEvent.keyDown( second, { key: 'Escape' } );
	expect( second ).not.toHaveAttribute( 'aria-pressed', 'true' );
	expect( screen.getByRole( 'dialog', { name: 'Sidebar' } ) ).toBeInTheDocument();
	fireEvent.keyDown( second, { key: 'Escape' } );
	await switcherClosed();
} );

it( 'focuses and keeps a narrow flyover open when the shortcut commits a hover preview', async () => {
	const { open, connector, user, trigger } = await setup( 800 );
	const sidebar = await open();
	act( () => connector.emit( 'onToggleSidebar' ) );
	expect( sidebar ).toContainElement( document.activeElement as HTMLElement );
	await user.unhover( trigger );
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 400 ) );
	} );
	expect( screen.getByRole( 'dialog', { name: 'Sidebar' } ) ).toBeInTheDocument();
	fireEvent.keyDown( document.activeElement!, { key: 'Escape' } );
	await switcherClosed();
} );

it.each( [
	[ 'Add site', 'Add site' ],
	[ 'Settings', 'Settings' ],
	[ 'Log in or create account', 'Do more with WordPress' ],
] )( 'dismisses the flyout while keeping the %s dialog open', async ( button, title ) => {
	const { open, user, trigger, connector } = await setup( 800 );
	const sidebar = await open();
	if ( button === 'Add site' ) {
		await user.click( within( sidebar ).getByRole( 'button', { name: button } ) );
	} else {
		await user.click( within( sidebar ).getByRole( 'button', { name: 'Account' } ) );
		await user.click(
			await screen.findByRole( 'menuitem', { name: new RegExp( `^${ button }` ) } )
		);
	}
	const dialog = await screen.findByRole( 'dialog', { name: title } );
	await switcherClosed();
	await waitFor( () => expect( dialog ).toContainElement( document.activeElement as HTMLElement ) );
	act( () => connector.emit( 'onToggleSidebar' ) );
	expect( screen.queryByRole( 'button', { name: 'Close sidebar' } ) ).not.toBeInTheDocument();
	await user.keyboard( '{Escape}' );
	await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
	await waitFor( () => expect( trigger ).toHaveFocus() );
	await user.click( trigger );
	expect( await screen.findByRole( 'dialog', { name: 'Sidebar' } ) ).toBeInTheDocument();
} );
