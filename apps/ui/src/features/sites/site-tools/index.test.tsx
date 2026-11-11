import { act, fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { createTestQueryClient, renderWithProviders } from '@/test/render';
import { SiteToolLauncher } from './index';

async function setup( active = true ) {
	const actions = {
		openBrowser: vi.fn(),
		openAdmin: vi.fn(),
		openDatabase: vi.fn(),
		openEmail: vi.fn(),
		openDesignSystem: vi.fn(),
	};
	const site = makeSite( { running: false } );
	const view = renderWithProviders(
		<>
			<input aria-label="Chat" />
			<SiteToolLauncher site={ site } actions={ actions } active={ active } />
		</>,
		{ connector: createFakeConnector() }
	);
	await screen.findByRole( 'group', { name: 'Project tools' } );
	return { ...view, actions };
}

it( 'opens tools without focusing the launcher and uses A for Admin', async () => {
	const { actions } = await setup();
	fireEvent.keyDown( document.body, { key: 'a' } );
	expect( actions.openAdmin ).toHaveBeenCalledOnce();
	expect( screen.getByRole( 'button', { name: 'Admin A' } ) ).toHaveAttribute(
		'aria-keyshortcuts',
		'A'
	);
	fireEvent.keyDown( document.body, { key: 'w' } );
	expect( actions.openAdmin ).toHaveBeenCalledOnce();
	fireEvent.keyDown( document.body, { key: 'B' } );
	expect( actions.openBrowser ).toHaveBeenCalledOnce();
} );

it( 'leaves typing, modified keys, repeats, and composition alone', async () => {
	const { actions } = await setup();
	fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Chat' } ), { key: 'a' } );
	for ( const options of [
		{ metaKey: true },
		{ ctrlKey: true },
		{ altKey: true },
		{ repeat: true },
		{ isComposing: true },
	] ) {
		fireEvent.keyDown( document.body, { key: 'a', ...options } );
	}
	expect( actions.openAdmin ).not.toHaveBeenCalled();
} );

it.each( [ 'menu', 'listbox', 'dialog' ] )( 'pauses behind an open %s', async ( role ) => {
	const { actions } = await setup();
	const popup = document.createElement( 'div' );
	popup.setAttribute( 'role', role );
	popup.setAttribute( 'data-open', '' );
	document.body.append( popup );
	try {
		fireEvent.keyDown( document.body, { key: 'b' } );
	} finally {
		popup.remove();
	}
	expect( actions.openBrowser ).not.toHaveBeenCalled();
	fireEvent.keyDown( document.body, { key: 'b' } );
	expect( actions.openBrowser ).toHaveBeenCalledOnce();
} );

it( 'does not intercept keys while its preview panel is hidden', async () => {
	const { actions } = await setup( false );
	fireEvent.keyDown( document.body, { key: 'b' } );
	expect( actions.openBrowser ).not.toHaveBeenCalled();
} );

it( 'ignores closed dialogs that stay mounted', async () => {
	const { actions } = await setup();
	const dialog = document.createElement( 'div' );
	dialog.setAttribute( 'role', 'dialog' );
	dialog.setAttribute( 'data-closed', '' );
	document.body.append( dialog );
	try {
		fireEvent.keyDown( document.body, { key: 'a' } );
	} finally {
		dialog.remove();
	}
	expect( actions.openAdmin ).toHaveBeenCalledOnce();
} );

it( 'hides an unreadable design system and its shortcut in the launcher', async () => {
	const queryClient = createTestQueryClient();
	const site = makeSite( { id: 'one', running: false } );
	const openDesignSystem = vi.fn();
	queryClient.setQueryData( [ 'site-design', 'one' ], {
		design: '---\ncolors:\n  primary: red\n---',
		themeJson: {},
	} );
	renderWithProviders(
		<SiteToolLauncher
			site={ site }
			actions={ {
				openBrowser: vi.fn(),
				openAdmin: vi.fn(),
				openDatabase: vi.fn(),
				openEmail: vi.fn(),
				openDesignSystem,
			} }
		/>,
		{ queryClient }
	);
	await screen.findByRole( 'group', { name: 'Project tools' } );
	expect( screen.queryByRole( 'button', { name: 'Design System S' } ) ).not.toBeInTheDocument();
	fireEvent.keyDown( document.body, { key: 's' } );
	expect( openDesignSystem ).not.toHaveBeenCalled();
	await act( () =>
		queryClient.setQueryData( [ 'site-design', 'one' ], {
			design:
				'---\ncolors:\n  primary: "#c2552b"\n  background: "#ffffff"\ntypography:\n  body:\n    fontFamily: "Inter"\n---',
			themeJson: {},
		} )
	);
	await screen.findByRole( 'button', { name: 'Design System S' } );
} );
