import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SIDEBAR_PANEL_STORAGE_KEY } from '@/data/resizable-panels';
import { HeaderSidebarToggle } from '@/features/sidebar/sidebar-toggle';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
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
afterEach( () => resize( originalWidth ) );

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
		fireEvent.keyDown( restored, { key: 'End' } );
		expect( restored ).toHaveAttribute( 'aria-valuenow', '320' );
		fireEvent.mouseDown( restored, { detail: 2 } );
		expect( restored ).toHaveAttribute( 'aria-valuenow', '256' );
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
} );

describe( 'overlay sidebar', () => {
	it( 'overlays the content below the docking width', async () => {
		localStorage.setItem( SIDEBAR_PANEL_STORAGE_KEY, '320' );
		resize( 935 );
		await setup();
		expect( toggle() ).toHaveAccessibleName( 'Show sidebar' );
		fireEvent.click( toggle() );
		expect( screen.queryByRole( 'separator', { name: 'Resize sidebar' } ) ).not.toBeInTheDocument();
		resize( 936 );
		expect( handle() ).toHaveAttribute( 'aria-valuenow', '256' );
		resize( 935 );
		expect( toggle() ).toHaveAccessibleName( 'Show sidebar' );
	} );

	it( 'dismisses a nested menu before the overlay and restores focus to the toggle', async () => {
		resize( 800 );
		await setup();
		fireEvent.click( toggle() );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Test User' } ) );
		const item = ( await screen.findAllByRole( 'menuitem' ) )[ 0 ];
		fireEvent.keyDown( item, { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument() );
		expect( screen.getByRole( 'button', { name: 'Close sidebar' } ) ).toBeInTheDocument();
		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Test User' } ), { key: 'Escape' } );
		expect( screen.queryByRole( 'button', { name: 'Close sidebar' } ) ).not.toBeInTheDocument();
		expect( toggle() ).toHaveFocus();
	} );

	it( 'does not replace a saved closed preference when opened with the keyboard', async () => {
		localStorage.setItem( 'studio-ui-sidebar-collapsed', 'true' );
		resize( 800 );
		const { connector } = await setup();
		act( () => connector.emit( 'onToggleSidebar' ) );
		expect( screen.getByRole( 'button', { name: 'Close sidebar' } ) ).toBeInTheDocument();
		expect( document.activeElement?.closest( 'aside' ) ).not.toBeNull();
		resize( 1440 );
		expect( toggle() ).toHaveAccessibleName( 'Show sidebar' );
		expect( localStorage.getItem( 'studio-ui-sidebar-collapsed' ) ).toBe( 'true' );
	} );
} );
