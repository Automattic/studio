import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SIDEBAR_PANEL_CONFIG } from '@/data/resizable-panels';
import { HeaderSidebarToggle } from '@/features/sidebar/sidebar-toggle';
import { renderWithProviders } from '@/test/render';
import { SidebarLayout } from './index';

const originalWidth = window.innerWidth;
const COLLAPSED_KEY = 'studio-ui-sidebar-collapsed';

function resize( available: number ) {
	act( () => {
		Object.defineProperty( window, 'innerWidth', {
			configurable: true,
			value: SIDEBAR_PANEL_CONFIG.defaultWidth + available,
		} );
		window.dispatchEvent( new Event( 'resize' ) );
	} );
}

function Layout( { chat: initialChat = true } ) {
	const [ chat, setChat ] = useState( initialChat );
	return (
		<SidebarLayout>
			<HeaderSidebarToggle />
			{ chat ? (
				<>
					<input aria-label="Draft" />
					<button onClick={ () => setChat( false ) }>Close chat</button>
				</>
			) : null }
			<div>Preview</div>
		</SidebarLayout>
	);
}

async function setup( options = {} ) {
	const view = renderWithProviders( <Layout { ...options } /> );
	await screen.findAllByRole( 'button', { name: /^(Show|Hide) sidebar$/ } );
	return view;
}

const toggle = () =>
	screen
		.getAllByRole( 'button', { name: /^(Show|Hide) sidebar$/ } )
		.find( ( button ) => ! button.closest( '[inert]' ) )!;
const docked = () => !! screen.queryByRole( 'separator', { name: 'Resize sidebar' } );

beforeEach( () => {
	localStorage.clear();
	resize( 1000 );
} );
afterEach( () => {
	Object.defineProperty( window, 'innerWidth', { configurable: true, value: originalWidth } );
} );

describe( 'workspace sidebar layout', () => {
	it( 'preserves a manual close through narrow and wide windows', async () => {
		await setup();
		fireEvent.click( toggle() );
		resize( 679 );
		resize( 1000 );
		expect( toggle() ).toHaveAccessibleName( 'Show sidebar' );
	} );

	it( 'keeps overlay actions separate from the saved docked preference', async () => {
		await setup();
		resize( 679 );
		fireEvent.click( toggle() );
		expect( toggle() ).toHaveAccessibleName( 'Hide sidebar' );
		fireEvent.click( toggle() );
		expect( localStorage.getItem( COLLAPSED_KEY ) ).not.toBe( 'true' );
		resize( 1000 );
		expect( toggle() ).toHaveAccessibleName( 'Hide sidebar' );
	} );

	it( 'uses overlay navigation for a single panel', async () => {
		resize( 679 );
		await setup( { chat: false } );
		expect( toggle() ).toHaveAccessibleName( 'Show sidebar' );
	} );

	it( 'keeps navigation hidden after closing chat and restores it only when space returns', async () => {
		await setup();
		resize( 544 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close chat' } ) );
		expect( toggle() ).toHaveAccessibleName( 'Show sidebar' );
		expect( docked() ).toBe( false );
		expect( localStorage.getItem( COLLAPSED_KEY ) ).not.toBe( 'true' );
		resize( 1000 );
		expect( toggle() ).toHaveAccessibleName( 'Hide sidebar' );
	} );

	it( 'preserves mounted content and draft text when opening and dismissing the overlay', async () => {
		resize( 544 );
		await setup();
		const draft = screen.getByRole( 'textbox', { name: 'Draft' } );
		const preview = screen.getByText( 'Preview' );
		fireEvent.change( draft, { target: { value: 'Keep this draft' } } );
		fireEvent.click( toggle() );
		expect( docked() ).toBe( false );
		expect( preview.closest( '[inert]' ) ).toBeNull();
		fireEvent.click( screen.getByRole( 'button', { name: 'Close sidebar' } ) );
		expect( screen.getByRole( 'textbox', { name: 'Draft' } ) ).toBe( draft );
		expect( draft ).toHaveValue( 'Keep this draft' );
		expect( screen.getByText( 'Preview' ) ).toBe( preview );
	} );
} );
