import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import styles from './style.module.css';

const sites = [
	makeSite( { id: 'one', name: 'My site' } ),
	makeSite( { id: 'two', name: 'Other site' } ),
];

const originalWidth = window.innerWidth;

async function setup( width = 1280 ) {
	Object.defineProperty( window, 'innerWidth', { configurable: true, value: width } );
	localStorage.setItem( 'studio-ui-sidebar-collapsed', 'true' );
	const view = renderApp( {
		connector: createFakeConnector( { sites, user: null } ),
		path: '/sites/one',
	} );
	const trigger = await waitFor( () => {
		const button = screen
			.getAllByRole( 'button', { name: 'Show sidebar' } )
			.find( ( candidate ) => ! candidate.closest( '[inert]' ) );
		expect( button ).toBeDefined();
		return button!;
	} );
	const open = async () => {
		await view.user.hover( trigger );
		await screen.findByRole( 'button', { name: 'Close sidebar' } );
		return within( screen.getByRole( 'dialog', { name: 'Sidebar' } ) ).getByRole( 'complementary' );
	};
	return { ...view, trigger, open };
}

const switcherClosed = () =>
	waitFor( () =>
		expect( screen.queryByRole( 'button', { name: 'Close sidebar' } ) ).not.toBeInTheDocument()
	);

beforeEach( () => localStorage.clear() );
afterEach( () =>
	Object.defineProperty( window, 'innerWidth', { configurable: true, value: originalWidth } )
);

describe( 'sidebar hover overlay', () => {
	it( 'lists the sites on hover and closes once one opens', async () => {
		const { connector, history, open } = await setup();
		const switcher = await open();
		fireEvent.click( await within( switcher ).findByRole( 'button', { name: /^Other site/ } ) );
		await switcherClosed();
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two/new' ) );
		expect( connector.createSession ).not.toHaveBeenCalled();
	} );

	it( 'closes on Escape, and leaves Escape alone while closed', async () => {
		const { trigger, open } = await setup();
		const switcher = await open();
		fireEvent.keyDown( switcher, { key: 'Escape' } );
		await switcherClosed();
		expect( fireEvent.keyDown( trigger, { key: 'Escape' } ) ).toBe( true );
	} );

	it( 'docks the sidebar at the top when the hovered toggle is clicked', async () => {
		const { trigger, open } = await setup();
		const sidebar = await open();
		sidebar.scrollTop = 120;
		fireEvent.click( trigger );
		expect(
			await screen.findByRole( 'separator', { name: 'Resize sidebar' } )
		).toBeInTheDocument();
		expect( screen.queryByRole( 'dialog', { name: 'Sidebar' } ) ).not.toBeInTheDocument();
		expect( document.activeElement ).toHaveAccessibleName( 'Hide sidebar' );
		expect(
			document.activeElement?.closest( 'aside' )?.querySelector( `.${ styles.sidebarScroll }` )
				?.scrollTop
		).toBe( 0 );
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

it( 'ignores touch hover and cancels a brief pointer pass', async () => {
	const { trigger, user } = await setup();
	fireEvent.pointerEnter( trigger, { pointerType: 'touch' } );
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 220 ) );
	} );
	expect( screen.queryByRole( 'button', { name: 'Close sidebar' } ) ).not.toBeInTheDocument();
	await user.hover( trigger );
	await user.unhover( trigger );
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 220 ) );
	} );
	expect( screen.queryByRole( 'button', { name: 'Close sidebar' } ) ).not.toBeInTheDocument();
} );

it( 'does not reopen on hover immediately after clicking to hide the sidebar', async () => {
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
	[ 'Log in', 'Do more with WordPress.com' ],
] )( 'dismisses the flyout while keeping the %s dialog open', async ( button, title ) => {
	const { open, user, trigger, connector } = await setup( 800 );
	const sidebar = await open();
	await user.click( within( sidebar ).getByRole( 'button', { name: button } ) );
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
