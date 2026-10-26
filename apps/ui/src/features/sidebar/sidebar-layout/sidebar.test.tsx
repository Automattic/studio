import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { resetLocaleData, setLocaleData } from '@wordpress/i18n';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetPanelLayout, SIDEBAR_PANEL_STORAGE_KEY } from '@/data/resizable-panels';
import { HeaderSidebarToggle } from '@/features/sidebar/sidebar-toggle';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp, renderWithProviders } from '@/test/render';
import { SidebarLayout } from './index';

const originalWidth = window.innerWidth;

function resize( width: number ) {
	act( () => {
		Object.defineProperty( window, 'innerWidth', { configurable: true, value: width } );
		window.dispatchEvent( new Event( 'resize' ) );
	} );
}

async function setup( connector = createFakeConnector() ) {
	const view = renderWithProviders(
		<SidebarLayout>
			<HeaderSidebarToggle />
		</SidebarLayout>,
		{ connector }
	);
	await screen.findAllByRole( 'button', { name: /^(Show|Hide) sidebar$/ } );
	return view;
}

// The toggle outside the inert half: in the sidebar while it's docked, in the
// header otherwise.
const toggle = () =>
	screen
		.getAllByRole( 'button', { name: /^(Show|Hide) sidebar$/ } )
		.find( ( button ) => ! button.closest( '[inert]' ) )!;
const handle = () => screen.getByRole( 'separator', { name: 'Resize sidebar' } );

beforeEach( () => {
	localStorage.clear();
	resize( 1280 );
} );
afterEach( () => {
	resize( originalWidth );
	resetLocaleData();
} );

describe( 'resizable sidebar', () => {
	it( 'resizes with the keyboard, clamps bounds, and persists its width', async () => {
		const { unmount } = await setup();
		expect( handle() ).toHaveAttribute( 'aria-valuenow', '256' );
		fireEvent.keyDown( handle(), { key: 'ArrowRight' } );
		expect( handle() ).toHaveAttribute( 'aria-valuenow', '272' );
		unmount();
		await setup();
		const restored = handle();
		expect( restored ).toHaveAttribute( 'aria-valuenow', '272' );
		fireEvent.keyDown( restored, { key: 'Home' } );
		fireEvent.keyDown( restored, { key: 'ArrowLeft' } );
		expect( restored ).toHaveAttribute( 'aria-valuenow', '256' );
		fireEvent.keyDown( restored, { key: 'ArrowRight', shiftKey: true } );
		expect( restored ).toHaveAttribute( 'aria-valuenow', '296' );
		fireEvent.keyDown( restored, { key: 'End' } );
		expect( restored ).toHaveAttribute( 'aria-valuenow', '320' );
		fireEvent.mouseDown( restored, { detail: 2 } );
		expect( restored ).toHaveAttribute( 'aria-valuenow', '256' );
	} );

	it( 'stays collapsed across restarts until the interface is reset', async () => {
		const { unmount } = await setup();
		fireEvent.click( toggle() );
		unmount();
		await setup();
		expect( toggle() ).toHaveAccessibleName( 'Show sidebar' );
		act( () => resetPanelLayout() );
		expect( toggle() ).toHaveAccessibleName( 'Hide sidebar' );
	} );

	it( 'drags the edge and retains width after collapsing and reopening', async () => {
		await setup();
		fireEvent.mouseDown( handle(), { button: 0, clientX: 256 } );
		fireEvent.mouseUp( document, { clientX: 320 } );
		expect( handle() ).toHaveAttribute( 'aria-valuenow', '320' );
		fireEvent.click( toggle() );
		expect( screen.queryByRole( 'separator', { name: 'Resize sidebar' } ) ).not.toBeInTheDocument();
		fireEvent.click( toggle() );
		expect( handle() ).toHaveAttribute( 'aria-valuenow', '320' );
	} );

	it( 'clamps a drag to the maximum and ignores non-primary buttons', async () => {
		await setup();
		fireEvent.mouseDown( handle(), { button: 2, clientX: 256 } );
		fireEvent.mouseUp( document, { clientX: 900 } );
		expect( handle() ).toHaveAttribute( 'aria-valuenow', '256' );
		expect( localStorage.getItem( SIDEBAR_PANEL_STORAGE_KEY ) ).toBeNull();
		fireEvent.mouseDown( handle(), { button: 0, clientX: 256 } );
		fireEvent.mouseUp( document, { clientX: 900 } );
		expect( handle() ).toHaveAttribute( 'aria-valuenow', '320' );
	} );

	it( 'mirrors the drag and arrow-key direction in RTL', async () => {
		setLocaleData( { 'text direction\u0004ltr': [ 'rtl' ] } );
		await setup();
		fireEvent.mouseDown( handle(), { button: 0, clientX: 500 } );
		fireEvent.mouseUp( document, { clientX: 460 } );
		expect( handle() ).toHaveAttribute( 'aria-valuenow', '296' );
		fireEvent.keyDown( handle(), { key: 'ArrowLeft' } );
		expect( handle() ).toHaveAttribute( 'aria-valuenow', '312' );
	} );
} );

describe( 'overlay sidebar', () => {
	it.each( [ false, true ] )(
		'does not pin on widening with the panel open: %s',
		async ( openPanel ) => {
			await setup();
			expect( handle() ).toBeInTheDocument();
			resize( 800 );
			if ( openPanel ) fireEvent.click( toggle() );
			resize( 1280 );
			expect(
				screen.queryByRole( 'separator', { name: 'Resize sidebar' } )
			).not.toBeInTheDocument();
			expect( !! screen.queryByRole( 'dialog', { name: 'Sidebar' } ) ).toBe( openPanel );
			fireEvent.click( toggle() );
			expect( handle() ).toBeInTheDocument();
		}
	);

	it( 'overlays the content below the docking width', async () => {
		localStorage.setItem( SIDEBAR_PANEL_STORAGE_KEY, '320' );
		resize( 935 );
		await setup();
		expect( toggle() ).toHaveAccessibleName( 'Show sidebar' );
		fireEvent.click( toggle() );
		expect( screen.queryByRole( 'separator', { name: 'Resize sidebar' } ) ).not.toBeInTheDocument();
		resize( 936 );
		expect( screen.queryByRole( 'separator', { name: 'Resize sidebar' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'dialog', { name: 'Sidebar' } ) ).toBeInTheDocument();
		fireEvent.click( toggle() );
		expect( handle() ).toHaveAttribute( 'aria-valuenow', '256' );
		resize( 935 );
		expect( toggle() ).toHaveAccessibleName( 'Show sidebar' );
	} );

	it( 'dismisses a nested menu before the overlay and restores focus to the toggle', async () => {
		resize( 800 );
		const { user } = await setup();
		fireEvent.click( toggle() );
		const sidebarFlyout = within( await screen.findByRole( 'dialog', { name: 'Sidebar' } ) );
		await user.click( await sidebarFlyout.findByRole( 'button', { name: 'Test User' } ) );
		const item = ( await screen.findAllByRole( 'menuitem' ) )[ 0 ];
		fireEvent.keyDown( item, { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument() );
		expect( screen.getByRole( 'button', { name: 'Close sidebar' } ) ).toBeInTheDocument();
		fireEvent.keyDown( sidebarFlyout.getByRole( 'button', { name: 'Test User' } ), {
			key: 'Escape',
		} );
		expect( screen.queryByRole( 'button', { name: 'Close sidebar' } ) ).not.toBeInTheDocument();
		await waitFor( () => expect( toggle() ).toHaveFocus() );
	} );

	it( 'focuses its first item on open and closes after a site pick', async () => {
		resize( 800 );
		renderApp( {
			connector: createFakeConnector( { sites: [ makeSite( { name: 'My site' } ) ] } ),
			path: '/sites/site-1',
		} );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Show sidebar' } ) );
		await waitFor( () => expect( document.activeElement?.closest( 'aside' ) ).not.toBeNull() );
		const sidebar = document.activeElement?.closest( 'aside' ) as HTMLElement;
		expect( sidebar ).toContainElement(
			within( screen.getByRole( 'dialog', { name: 'Sidebar' } ) ).getByRole( 'button', {
				name: 'Test User',
			} )
		);
		fireEvent.click( await within( sidebar ).findByRole( 'button', { name: /^My site/ } ) );
		expect( screen.queryByRole( 'button', { name: 'Close sidebar' } ) ).not.toBeInTheDocument();
	} );

	it( 'does not replace a saved closed preference when opened with the keyboard', async () => {
		localStorage.setItem( 'studio-ui-sidebar-collapsed', 'true' );
		resize( 800 );
		const { connector } = await setup();
		act( () => connector.emit( 'onToggleSidebar' ) );
		expect( screen.getByRole( 'button', { name: 'Close sidebar' } ) ).toBeInTheDocument();
		await waitFor( () => expect( document.activeElement?.closest( 'aside' ) ).not.toBeNull() );
		resize( 1440 );
		expect( toggle() ).toHaveAccessibleName( 'Show sidebar' );
		expect( localStorage.getItem( 'studio-ui-sidebar-collapsed' ) ).toBe( 'true' );
	} );
} );
