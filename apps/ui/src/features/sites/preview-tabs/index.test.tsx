import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setCommandPaletteOpen } from '@/data/use-command-palette';
import {
	changeAnnotation,
	pickAnnotation,
	stageAnnotations,
	setAnnotating,
	removeAnnotations,
	getSiteAnnotations,
} from '@/features/annotations';
import { clearComposerDrafts } from '@/features/composer';
import { createFakeConnector, makeSession, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { SessionEntry } from '@/data/core';

beforeEach( () => {
	localStorage.clear();
	clearComposerDrafts();
} );
afterEach( () => {
	vi.restoreAllMocks();
	document.documentElement.style.removeProperty( '--motion-duration-surface' );
	act( () => {
		setCommandPaletteOpen( false );
		removeAnnotations(
			'one',
			getSiteAnnotations( 'one' ).notes.map( ( note ) => note.id )
		);
		setAnnotating( 'one', false );
	} );
} );
async function setup( running = true, signedIn = false ) {
	const connector = createFakeConnector( {
		user: signedIn ? TEST_USER : null,
		sites: [
			makeSite( { id: 'one', name: 'First', running } ),
			makeSite( { id: 'two', name: 'Second', running } ),
		],
	} );
	const view = renderApp( { connector, path: '/sites/one/new' } );
	await screen.findByRole( 'button', { name: 'Site menu' } );
	if ( screen.queryByRole( 'button', { name: 'Show panel' } ) )
		fireEvent.click( screen.getByRole( 'button', { name: 'Show panel' } ) );
	return { ...view, connector };
}
const selectedTab = () =>
	screen.getAllByRole( 'tab' ).find( ( tab ) => tab.getAttribute( 'aria-selected' ) === 'true' )!;
async function newBrowserTab() {
	fireEvent.click( screen.getByRole( 'button', { name: 'New tab' } ) );
	fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Browser' } ) );
	await waitFor( () => expect( selectedTab() ).toHaveFocus() );
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).not.toHaveFocus();
}

it.each( [ true, false ] )(
	'opens a chat tool link in a new tab (panel open: %s)',
	async ( open ) => {
		const connector = createFakeConnector( {
			sites: [ makeSite( { id: 'one', name: 'First', running: true } ) ],
			sessions: [
				{
					summary: makeSession( { id: 'chat', ownerSiteId: 'one' } ),
					entries: [
						{
							id: 'reply',
							type: 'message',
							message: {
								role: 'assistant',
								content: [
									{
										type: 'text',
										text: 'Updated the [design system](studio:design-system) with warmer colors.',
									},
								],
							},
						} as SessionEntry,
					],
				},
			],
		} );
		const { user } = renderApp( { connector, path: '/sessions/chat' } );
		const chip = await screen.findByRole( 'button', { name: 'Open design system' } );
		if ( screen.queryByRole( 'button', { name: 'Show panel' } ) )
			await user.click( screen.getByRole( 'button', { name: 'Show panel' } ) );
		const address = screen.getByRole( 'textbox', { name: 'Address' } );
		await user.clear( address );
		await user.type( address, '/about/{Enter}' );
		const firstTab = screen.getByRole( 'tab', { name: 'First' } );
		const firstPage = document.querySelector( 'iframe' );
		if ( ! open ) await user.click( screen.getByRole( 'button', { name: 'Hide panel' } ) );
		await user.click( chip );
		expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 2 );
		expect( screen.getByRole( 'tab', { name: 'Design system' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
		expect( screen.getByRole( 'button', { name: 'Hide panel' } ) ).toBeVisible();
		expect( document.querySelector( 'iframe' ) ).toBe( firstPage );
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
		await user.click( firstTab );
		expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
			'http://localhost:9010/about/'
		);
	}
);

it( 'opens DevTools for the selected browser tab while retaining the other guests', async () => {
	const userAgent = window.navigator.userAgent;
	Object.defineProperty( window.navigator, 'userAgent', {
		value: `${ userAgent } Electron/38.0.0`,
		configurable: true,
	} );
	const openWebviewDevTools = vi.fn().mockResolvedValue( undefined );
	vi.stubGlobal( 'ipcApi', { openWebviewDevTools } );
	try {
		const { user } = await setup();
		const first = selectedTab();
		const firstGuest = document.querySelector( 'webview' )!;
		Object.assign( firstGuest, { getWebContentsId: () => 42 } );
		await newBrowserTab();
		const guests = document.querySelectorAll( 'webview' );
		expect( guests ).toHaveLength( 2 );
		Object.assign( guests[ 1 ], { getWebContentsId: () => 43 } );
		for ( const id of [ 43, 42 ] ) {
			if ( id === 42 ) await user.click( first );
			screen.getByRole( 'button', { name: 'Browser options' } ).focus();
			await user.keyboard( '{ArrowDown}' );
			await user.click( screen.getByRole( 'menuitem', { name: 'Developer tools' } ) );
			expect( openWebviewDevTools ).toHaveBeenLastCalledWith( id );
		}
		expect( document.querySelector( 'webview' ) ).toBe( firstGuest );
	} finally {
		Object.defineProperty( window.navigator, 'userAgent', {
			value: userAgent,
			configurable: true,
		} );
		vi.unstubAllGlobals();
	}
} );

it.each( [ 'header', 'shortcut', 'palette' ] )(
	'returns from chat-only view to the preview using the %s',
	async ( control ) => {
		const { connector } = await setup( true, true );
		const page = document.querySelector( 'iframe' );
		const composer = await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
		fireEvent.change( composer, { target: { value: 'Keep this draft' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Expand panel' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Hide panel' } ) );
		expect( composer ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Show panel' } ) ).toBeVisible();
		if ( control === 'header' ) {
			fireEvent.click( screen.getByRole( 'button', { name: 'Show panel' } ) );
		} else if ( control === 'shortcut' ) {
			act( () => connector.emit( 'onTogglePanel' ) );
		} else {
			act( () => setCommandPaletteOpen( true ) );
			fireEvent.change( await screen.findByRole( 'combobox', { name: 'Search commands' } ), {
				target: { value: 'Toggle panel' },
			} );
			fireEvent.click( await screen.findByRole( 'option', { name: 'Toggle panel' } ) );
		}
		await waitFor( () => expect( composer ).toBeVisible() );
		expect( document.querySelector( 'iframe' ) ).toBe( page );
		fireEvent.click( screen.getByRole( 'button', { name: 'Hide panel' } ) );
		await waitFor( () => expect( composer ).toBeVisible() );
		fireEvent.click( screen.getByRole( 'button', { name: 'Show panel' } ) );
		expect( screen.getByRole( 'button', { name: 'Hide panel' } ) ).toHaveAttribute(
			'data-workspace-layout',
			'split'
		);
		expect( composer ).toHaveValue( 'Keep this draft' );
	}
);
it.each( [ false, true ] )(
	'restores the normal stopped preview after closing the final tab (thumbnail: %s)',
	async ( thumbnail ) => {
		const { connector } = await setup();
		connector.getSiteThumbnail.mockResolvedValue( thumbnail ? 'data:image/png;base64,eA==' : null );
		const first = screen.getByRole( 'tab', { name: 'First' } );
		const frame = document.querySelector( 'iframe' );
		await newBrowserTab();
		expect( screen.getAllByRole( 'tab' )[ 1 ] ).toHaveAttribute( 'aria-selected', 'true' );
		expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
			'http://localhost:9010'
		);
		expect( document.querySelectorAll( 'iframe' ) ).toHaveLength( 2 );
		fireEvent.click( first );
		expect( document.querySelector( 'iframe' ) ).toBe( frame );
		fireEvent.click( screen.getAllByRole( 'button', { name: 'Close First' } )[ 1 ] );
		expect( first ).toHaveAttribute( 'aria-selected', 'true' );
		expect( connector.stopSite ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Expand panel' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close First' } ) );
		const show = await screen.findByRole( 'button', { name: 'Show panel' } );
		await waitFor( () => expect( show ).toHaveFocus() );
		expect( document.querySelector( 'iframe' ) ).not.toBeInTheDocument();
		fireEvent.click( show );
		await waitFor( () =>
			expect( screen.queryByRole( 'button', { name: 'Expand panel' } ) ).not.toBeInTheDocument()
		);
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
		await waitFor( () => expect( screen.queryByRole( 'tab' ) ).not.toBeInTheDocument() );
		expect(
			screen.queryByRole( 'toolbar', { name: 'Preview browser controls' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'complementary', { name: 'Panel' } ).querySelector( 'canvas' )
		).toBeInTheDocument();
		const pane = screen.getByRole( 'complementary', { name: 'Panel' } );
		expect(
			await within( pane ).findByRole( 'button', {
				name: 'Browser B',
			} )
		).toBeVisible();
	}
);
it( 'retains separate mounted pages and restores each project’s tabs', async () => {
	await setup();
	const firstFrame = document.querySelector( 'iframe' );
	await newBrowserTab();
	const address = screen.getByRole( 'textbox', { name: 'Address' } );
	fireEvent.change( address, { target: { value: '/about/' } } );
	fireEvent.submit( address.closest( 'form' )! );
	await waitFor( () => expect( document.querySelectorAll( 'iframe' ) ).toHaveLength( 2 ) );
	expect(
		Array.from( document.querySelectorAll( 'iframe' ) ).map( ( frame ) => frame.src )
	).toContain( 'http://localhost:9010/about/' );
	const tabs = screen.getAllByRole( 'tab' );
	fireEvent.click( tabs[ 0 ] );
	expect( document.querySelector( 'iframe' ) ).toBe( firstFrame );
	fireEvent.click( tabs[ 1 ] );
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
		'http://localhost:9010/about/'
	);
	const sites = screen.getByRole( 'group', { name: 'Sites' } );
	fireEvent.click( within( sites ).getByRole( 'button', { name: 'Second' } ) );
	await screen.findByRole( 'tab', { name: 'Second' } );
	fireEvent.click( within( sites ).getByRole( 'button', { name: 'First' } ) );
	await waitFor( () => expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 2 ) );
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
		'http://localhost:9010/about/'
	);
} );
it( 'reloads only the selected tab from the command palette', async () => {
	await setup();
	const first = document.querySelector( 'iframe' );
	await newBrowserTab();
	const second = document.querySelectorAll( 'iframe' )[ 1 ];
	act( () => setCommandPaletteOpen( true ) );
	fireEvent.change( await screen.findByRole( 'combobox', { name: 'Search commands' } ), {
		target: { value: 'Reload preview' },
	} );
	fireEvent.click( screen.getByRole( 'option', { name: 'Reload preview' } ) );
	await waitFor( () => expect( second ).not.toBeInTheDocument() );
	expect( document.querySelector( 'iframe' ) ).toBe( first );
	fireEvent.click( screen.getAllByRole( 'tab' )[ 0 ] );
	expect( document.querySelector( 'iframe' ) ).toBe( first );
} );
it( 'restarts at home after stopping a project while another project is open', async () => {
	const { connector } = await setup();
	const firstInput = screen.getByRole( 'textbox', { name: 'Address' } );
	fireEvent.change( firstInput, { target: { value: '/portfolio/' } } );
	fireEvent.submit( firstInput.closest( 'form' )! );
	await newBrowserTab();
	const input = screen.getByRole( 'textbox', { name: 'Address' } );
	fireEvent.change( input, { target: { value: '/about/' } } );
	fireEvent.submit( input.closest( 'form' )! );
	const sites = within( screen.getByRole( 'group', { name: 'Sites' } ) );
	fireEvent.click( sites.getByRole( 'button', { name: 'Second' } ) );
	await screen.findByRole( 'tab', { name: 'Second' } );
	await act( () => connector.stopSite( 'one' ) );
	fireEvent.click( sites.getByRole( 'button', { name: 'First' } ) );
	await screen.findByRole( 'button', { name: 'Start First' } );
	fireEvent.click( screen.getByRole( 'button', { name: 'Start First' } ) );
	await waitFor( () => expect( document.querySelectorAll( 'iframe' ) ).toHaveLength( 2 ) );
	document.querySelectorAll( 'iframe' ).forEach( ( frame ) => fireEvent.load( frame ) );
	expect( await screen.findByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
		'http://localhost:9010'
	);
	fireEvent.click( screen.getAllByRole( 'tab' )[ 0 ] );
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
		'http://localhost:9010/portfolio/'
	);
} );
it( 'keeps stopped and blank tabs empty without a browser bar', async () => {
	const { connector, user } = await setup( false );
	expect( screen.queryByRole( 'tablist', { name: 'Preview tabs' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'New tab' } ) ).toBeVisible();
	expect(
		screen.queryByRole( 'toolbar', { name: 'Preview browser controls' } )
	).not.toBeInTheDocument();
	await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
	expect( screen.queryByRole( 'tab' ) ).not.toBeInTheDocument();
	expect( await screen.findByRole( 'menuitem', { name: 'Browser' } ) ).toBeVisible();
	await user.keyboard( '{Escape}' );
	expect( screen.queryByRole( 'textbox', { name: 'Address' } ) ).not.toBeInTheDocument();
	const pane = screen.getByRole( 'complementary', { name: 'Panel' } );
	expect( within( pane ).getByRole( 'group', { name: 'Project tools' } ) ).toBeVisible();
	expect( within( pane ).queryByRole( 'img' ) ).not.toBeInTheDocument();
	expect( document.querySelector( 'iframe' ) ).not.toBeInTheDocument();
	expect( connector.startSite ).not.toHaveBeenCalled();
} );

it( 'opens external addresses outside the project and resets tabs on a new app session', async () => {
	const { connector, unmount } = await setup();
	const input = screen.getByRole( 'textbox', { name: 'Address' } );
	fireEvent.change( input, { target: { value: 'https://example.com/about' } } );
	fireEvent.submit( input.closest( 'form' )! );
	expect( connector.openExternalUrl ).toHaveBeenCalledWith( 'https://example.com/about' );
	expect( input ).toHaveValue( 'http://localhost:9010' );
	await newBrowserTab();
	expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 2 );
	unmount();
	await setup();
	expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 1 );
} );
it( 'keeps many tabs accessible, navigates by keyboard, and closes to the adjacent tab', async () => {
	const { user } = await setup();
	for ( let i = 0; i < 8; i++ ) await newBrowserTab();
	const tabs = screen.getAllByRole( 'tab' );
	expect( tabs ).toHaveLength( 9 );
	await waitFor( () => expect( selectedTab() ).toHaveFocus() );
	await user.click( tabs[ 1 ] );
	await user.keyboard( '{ArrowRight}' );
	expect( tabs[ 2 ] ).toHaveFocus();
	fireEvent.click( tabs[ 2 ] );
	fireEvent.click( screen.getAllByRole( 'button', { name: 'Close First' } )[ 2 ] );
	expect( screen.getAllByRole( 'tab' )[ 2 ] ).toHaveAttribute( 'aria-selected', 'true' );
	expect( screen.getByRole( 'button', { name: 'New tab' } ) ).toBeVisible();
} );
it( 'keeps Electron navigation and titles independent between mounted tabs', async () => {
	vi.spyOn( navigator, 'userAgent', 'get' ).mockReturnValue( 'Mozilla/5.0 Electron/38.0.0' );
	await setup();
	const prepare = ( el: Element, back: boolean, url: string ) => {
		const goBack = vi.fn();
		Object.assign( el, {
			getWebContentsId: () => ( back ? 2 : 1 ),
			executeJavaScript: vi.fn( async () => '' ),
			canGoBack: () => back,
			canGoForward: () => false,
			goBack,
			loadURL: vi.fn( async () => {} ),
			reload: vi.fn(),
			stop: vi.fn(),
		} );
		fireEvent( el, new Event( 'dom-ready' ) );
		fireEvent( el, Object.assign( new Event( 'did-navigate' ), { url } ) );
		return goBack;
	};
	const first = document.querySelector( 'webview' )!;
	const firstBack = prepare( first, false, 'http://localhost:9010/' );
	await newBrowserTab();
	const input = screen.getByRole( 'textbox', { name: 'Address' } );
	fireEvent.change( input, { target: { value: '/about/' } } );
	fireEvent.submit( input.closest( 'form' )! );
	await waitFor( () => expect( document.querySelectorAll( 'webview' ) ).toHaveLength( 2 ) );
	const second = document.querySelectorAll( 'webview' )[ 1 ];
	const secondBack = prepare( second, true, 'http://localhost:9010/about/' );
	fireEvent(
		second,
		Object.assign( new Event( 'page-title-updated' ), { title: 'About this project' } )
	);
	await screen.findByRole( 'tab', { name: 'About this project' } );
	fireEvent( window, new Event( 'resize' ) );
	fireEvent( second, new Event( 'did-start-loading' ) );
	expect( selectedTab() ).toHaveTextContent( 'About this project' );
	fireEvent(
		second,
		Object.assign( new Event( 'did-navigate' ), { url: 'http://localhost:9010/about/' } )
	);
	expect( selectedTab() ).toHaveTextContent( 'About this project' );
	fireEvent(
		second,
		Object.assign( new Event( 'page-title-updated' ), { title: 'Updated page title' } )
	);
	expect( selectedTab() ).toHaveTextContent( 'Updated page title' );
	fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
	expect( secondBack ).toHaveBeenCalledOnce();
	expect( firstBack ).not.toHaveBeenCalled();
	fireEvent.click( screen.getAllByRole( 'tab' )[ 0 ] );
	expect( screen.getByRole( 'button', { name: 'Back' } ) ).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	expect( document.querySelector( 'webview' ) ).toBe( first );
	await act( async () => {} );
} );

it( 'opens the right-clicked tab in the preferred browser without selecting it', async () => {
	const { connector } = await setup();
	await act( () => connector.setUserPreferences( { browser: 'firefox' } ) );
	const address = screen.getByRole( 'textbox', { name: 'Address' } );
	fireEvent.change( address, { target: { value: '/about/?source=preview#team' } } );
	fireEvent.submit( address.closest( 'form' )! );
	await newBrowserTab();
	const tabs = screen.getAllByRole( 'tab' );
	fireEvent.contextMenu( tabs[ 0 ] );
	const open = await screen.findByRole( 'menuitem', { name: 'Open in Firefox' } );
	expect( screen.getAllByRole( 'menuitem' )[ 0 ] ).toBe( open );
	expect( screen.getByRole( 'separator' ) ).toBeInTheDocument();
	fireEvent.click( open );
	expect( connector.openSiteUrl ).toHaveBeenCalledWith( 'one', '/about/?source=preview#team', {
		autoLogin: false,
	} );
	expect( tabs[ 1 ] ).toHaveAttribute( 'aria-selected', 'true' );
} );

it.each( [
	'/wp-admin/edit.php?post_type=page',
	'/phpmyadmin/index.php?route=/database/structure&db=wordpress',
] )( 'preserves authenticated tool navigation when opening %s externally', async ( path ) => {
	const { connector } = await setup();
	const address = screen.getByRole( 'textbox', { name: 'Address' } );
	fireEvent.change( address, { target: { value: path } } );
	fireEvent.submit( address.closest( 'form' )! );
	fireEvent.contextMenu( selectedTab() );
	fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Open in Browser' } ) );
	const target = path.startsWith( '/wp-admin/' )
		? `/studio-auto-login?redirect_to=${ encodeURIComponent( `http://localhost:9010${ path }` ) }`
		: path;
	expect( connector.openSiteUrl ).toHaveBeenCalledWith( 'one', target, {
		autoLogin: ! path.startsWith( '/wp-admin/' ),
	} );
} );

it.each( [
	[ 'MacIntel', 'Finder' ],
	[ 'Win32', 'File Explorer' ],
	[ 'Linux x86_64', 'File manager' ],
] )(
	'opens an email tab in the system file manager on %s without selecting it',
	async ( platform, label ) => {
		vi.spyOn( navigator, 'platform', 'get' ).mockReturnValue( platform );
		const { connector } = await setup();
		await act( () => connector.setUserPreferences( { browser: 'firefox' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'New tab' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Email log' } ) );
		const active = screen.getByRole( 'tab', { name: 'First' } );
		fireEvent.click( active );
		fireEvent.contextMenu( await screen.findByRole( 'tab', { name: 'Email log' } ) );
		const open = await screen.findByRole( 'menuitem', { name: `Open in ${ label }` } );
		expect( open ).not.toHaveAttribute( 'aria-disabled', 'true' );
		expect( screen.queryByRole( 'menuitem', { name: 'Open in Firefox' } ) ).not.toBeInTheDocument();
		fireEvent.click( open );
		expect( connector.openSiteEmailFolder ).toHaveBeenCalledExactlyOnceWith( 'one' );
		expect( connector.openSiteUrl ).not.toHaveBeenCalled();
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
		expect( active ).toHaveAttribute( 'aria-selected', 'true' );
	}
);

it( 'closes tabs from the context menu without selecting the right-clicked tab', async () => {
	await setup();
	for ( let i = 0; i < 3; i++ ) await newBrowserTab();
	let tabs = screen.getAllByRole( 'tab' );
	await waitFor( () => expect( selectedTab() ).toHaveFocus() );
	fireEvent.contextMenu( tabs[ 1 ] );
	expect( tabs[ 3 ] ).toHaveAttribute( 'aria-selected', 'true' );
	fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Close tabs to the right' } ) );
	await waitFor( () => expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 2 ) );
	tabs = screen.getAllByRole( 'tab' );
	expect( tabs[ 1 ] ).toHaveAttribute( 'aria-selected', 'true' );
	await waitFor( () => expect( tabs[ 1 ] ).toHaveFocus() );
	fireEvent.contextMenu( tabs[ 0 ] );
	await screen.findByRole( 'menuitem', { name: 'Close other tabs' } );
	expect( screen.getAllByRole( 'menuitem' ).map( ( item ) => item.textContent ) ).toEqual( [
		'Open in Browser',
		'Close tab',
		'Close other tabs',
		'Close all tabs',
	] );
	fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Close other tabs' } ) );
	await waitFor( () => expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 1 ) );
	const remaining = screen.getByRole( 'tab', { name: 'First' } );
	expect( remaining ).toHaveAttribute( 'aria-selected', 'true' );
	await waitFor( () => expect( remaining ).toHaveFocus() );
	fireEvent.contextMenu( remaining );
	expect( screen.getAllByRole( 'menuitem' ).map( ( item ) => item.textContent ) ).toEqual( [
		'Open in Browser',
		'Close tab',
	] );
	fireEvent.click( screen.getByRole( 'menuitem', { name: /^Close tab$/ } ) );
	await screen.findByRole( 'button', { name: 'Show panel' } );
} );

it( 'opens the tab menu from the keyboard and stops the site when closing all tabs', async () => {
	const { connector } = await setup();
	await newBrowserTab();
	const tab = screen.getAllByRole( 'tab' )[ 1 ];
	fireEvent.focus( tab );
	fireEvent.keyDown( tab, { key: 'F10', shiftKey: true } );
	fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Close all tabs' } ) );
	const show = await screen.findByRole( 'button', { name: 'Show panel' } );
	await waitFor( () => expect( show ).toHaveFocus() );
	fireEvent.click( show );
	await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
	await waitFor( () => expect( screen.queryByRole( 'tab' ) ).not.toBeInTheDocument() );
	expect( document.querySelector( 'iframe' ) ).not.toBeInTheDocument();
} );

it( 'shares the same tool items with the site menu and opens each preview tool in a new tab', async () => {
	const { user } = await setup();
	await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
	const labels = ( await screen.findAllByRole( 'menuitem' ) ).map( ( item ) => item.textContent );
	expect( labels ).toEqual( [ 'BrowserB', 'AdminA', 'DatabaseD', 'Email logE' ] );
	await user.keyboard( '{Escape}' );
	await user.click( screen.getByRole( 'button', { name: 'Site menu' } ) );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Tools' } ) );
	const admin = await screen.findByRole( 'menuitem', { name: 'Admin' } );
	const tools = admin.closest( '[role="menu"]' ) as HTMLElement;
	expect(
		within( tools )
			.getAllByRole( 'menuitem' )
			.map( ( item ) => item.textContent )
	).toEqual( labels );
	await user.keyboard( '{Escape}{Escape}' );
	for ( const name of [ 'Admin', 'Database' ] ) {
		await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
		const item = await screen.findByRole( 'menuitem', { name } );
		const icon = item.querySelector( 'svg' )!.innerHTML;
		await user.click( item );
		expect( screen.getByRole( 'tab', { name } ) ).toHaveAttribute( 'aria-selected', 'true' );
		expect( screen.getByRole( 'tab', { name } ).querySelector( 'svg' )!.innerHTML ).toBe( icon );
		await waitFor( () => expect( selectedTab() ).toHaveFocus() );
	}
	expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 3 );
	const sources = Array.from( document.querySelectorAll( 'iframe' ), ( frame ) => frame.src );
	expect( sources.some( ( src ) => src.includes( 'studio-auto-login' ) ) ).toBe( true );
	expect( sources.some( ( src ) => src.includes( 'phpmyadmin' ) ) ).toBe( true );
	await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Email log' } ) );
	expect( screen.getByRole( 'tab', { name: 'Email log' } ) ).toHaveAttribute(
		'aria-selected',
		'true'
	);
	expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 4 );
	expect(
		screen.queryByRole( 'toolbar', { name: 'Preview browser controls' } )
	).not.toBeInTheDocument();
} );

it( 'starts a stopped project from Browser and uses its first preview tab', async () => {
	const { connector, user } = await setup( false );
	await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Browser' } ) );
	await waitFor( () => expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
	await waitFor( () => expect( document.querySelector( 'iframe' ) ).not.toBeNull() );
	fireEvent.load( document.querySelector( 'iframe' )! );
	await waitFor( () => expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 1 ) );
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
		'http://localhost:9010'
	);
} );

it.each( [
	[ 'b', 'localhost:9010/' ],
	[ 'a', 'studio-auto-login' ],
	[ 'D', 'phpmyadmin' ],
] )( 'opens a new tool tab with %s while the plus menu is open', async ( key, destination ) => {
	const { user } = await setup();
	await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
	await screen.findByRole( 'menuitem', { name: 'Browser' } );
	await user.keyboard( key );
	await waitFor( () => expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 2 ) );
	const selected = document.querySelector( '[data-active-tab] iframe' ) as HTMLIFrameElement;
	expect( selected.src ).toContain( destination );
	expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument();
} );

it( 'uses the same letter shortcuts in Tools without intercepting modified keys or chat text', async () => {
	const { connector, user } = await setup();
	await user.click( screen.getByRole( 'button', { name: 'Site menu' } ) );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Tools' } ) );
	await screen.findByRole( 'menuitem', { name: 'Email log' } );
	await user.keyboard( '{Control>}e{/Control}' );
	expect( connector.openSiteEmailFolder ).not.toHaveBeenCalled();
	await user.keyboard( 'e' );
	expect( screen.getByRole( 'tab', { name: 'Email log' } ) ).toHaveAttribute(
		'aria-selected',
		'true'
	);
	const composer = screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } );
	await user.type( composer, 'bwdse' );
	expect( composer ).toHaveValue( 'bwdse' );
	expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 2 );
	expect( connector.openSiteEmailFolder ).not.toHaveBeenCalled();
} );

it( 'only offers the design-system shortcut when a design system is available', async () => {
	const { connector, queryClient, user } = await setup();
	await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
	await screen.findByRole( 'menuitem', { name: 'Browser' } );
	await user.keyboard( 's' );
	expect( screen.queryByRole( 'menuitem', { name: 'Design system' } ) ).not.toBeInTheDocument();
	await user.keyboard( '{Escape}' );
	connector.getSiteDesign.mockResolvedValue( { design: '# Invalid design', themeJson: {} } );
	await act( async () => {
		await queryClient.invalidateQueries( { queryKey: [ 'site-design', 'one' ] } );
	} );
	await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
	await screen.findByRole( 'menuitem', { name: 'Browser' } );
	expect( screen.queryByRole( 'menuitem', { name: 'Design system' } ) ).not.toBeInTheDocument();
	await user.keyboard( '{Escape}' );
	connector.getSiteDesign.mockResolvedValue( {
		design: `---
colors:
  primary: "#c2552b"
  background: "#ffffff"
typography:
  body:
    fontFamily: "Inter"
---
# Design system`,
		themeJson: {},
	} );
	await act( async () => {
		await queryClient.invalidateQueries( { queryKey: [ 'site-design', 'one' ] } );
	} );
	await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
	const design = await screen.findByRole( 'menuitem', { name: 'Design system' } );
	expect( design ).toHaveAttribute( 'aria-keyshortcuts', 'S' );
	const designIcon = design.querySelector( 'svg' )!.innerHTML;
	await user.keyboard( 's' );
	await waitFor( () => expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 2 ) );
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue( 'Design system' );
	expect(
		screen.getByRole( 'tab', { name: 'Design system' } ).querySelector( 'svg' )!.innerHTML
	).toBe( designIcon );
	expect( screen.getByRole( 'tab', { name: 'Design system' } ) ).toHaveAttribute(
		'aria-selected',
		'true'
	);
} );

it.each( [ false, true ] )(
	'animates startup from the Browser menu before the server is ready (blank tab: %s)',
	async ( blank ) => {
		const { connector, user } = await setup( blank );
		if ( blank ) {
			fireEvent.click( screen.getByRole( 'button', { name: 'Close First' } ) );
			await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
			await screen.findByRole( 'button', { name: 'Start First' } );
			fireEvent.click( screen.getByRole( 'button', { name: 'Show panel' } ) );
		}
		let resume!: () => void;
		const ready = new Promise< void >( ( resolve ) => {
			resume = resolve;
		} );
		const start = connector.startSite.getMockImplementation()!;
		connector.startSite.mockImplementation( async ( id ) => {
			await ready;
			return start( id );
		} );
		await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
		await user.click( await screen.findByRole( 'menuitem', { name: 'Browser' } ) );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'one' ) );
		const preview = screen.getByRole( 'complementary', { name: 'Panel' } );
		expect( within( preview ).getByText( 'Loading site preview' ) ).toBeInTheDocument();
		expect( preview.querySelector( 'canvas' ) ).not.toBeNull();
		expect( preview.querySelector( 'span[aria-hidden="true"][data-active]' ) ).not.toBeNull();
		expect(
			screen.queryByRole( 'toolbar', { name: 'Preview browser controls' } )
		).not.toBeInTheDocument();
		await act( async () => {
			resume();
			await ready;
		} );
		await waitFor( () => expect( document.querySelector( 'iframe' ) ).not.toBeNull() );
		fireEvent.load( document.querySelector( 'iframe' )! );
		await waitFor( () =>
			expect( screen.queryByText( 'Loading site preview' ) ).not.toBeInTheDocument()
		);
		expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
			'http://localhost:9010'
		);
	}
);

it( 'closes the panel immediately while the final tab’s site is still stopping', async () => {
	const { connector } = await setup();
	let finish!: () => void;
	const stopping = new Promise< void >( ( resolve ) => {
		finish = resolve;
	} );
	const stop = connector.stopSite.getMockImplementation()!;
	connector.stopSite.mockImplementation( async ( id ) => {
		await stopping;
		return stop( id );
	} );
	fireEvent.click( screen.getByRole( 'button', { name: 'Close First' } ) );
	await screen.findByRole( 'button', { name: 'Show panel' } );
	await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
	expect( document.querySelector( 'iframe' ) ).not.toBeInTheDocument();
	await act( async () => {
		finish();
		await stopping;
	} );
	await waitFor( () => expect( connector.state.sites[ 0 ].running ).toBe( false ) );
} );

it.each( [ false, true ] )(
	'opens Browser from Tools in its own tab (running: %s)',
	async ( running ) => {
		const { connector, user } = await setup( running );
		if ( running ) {
			const address = screen.getByRole( 'textbox', { name: 'Address' } );
			fireEvent.change( address, { target: { value: '/about/' } } );
			fireEvent.submit( address.closest( 'form' )! );
		}
		const original = document.querySelector( 'iframe' );
		await user.click( screen.getByRole( 'button', { name: 'Site menu' } ) );
		await user.click( await screen.findByRole( 'menuitem', { name: 'Tools' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Browser' } ) );
		await waitFor( () => expect( screen.getAllByRole( 'tab' ) ).toHaveLength( running ? 2 : 1 ) );
		if ( ! running ) {
			expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' );
			fireEvent.load( document.querySelector( 'iframe' )! );
		}
		await waitFor( () =>
			expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
				'http://localhost:9010'
			)
		);
		if ( running ) {
			expect( document.querySelector( 'iframe' ) ).toBe( original );
			expect( original?.src ).toContain( '/about/' );
			fireEvent.click( screen.getAllByRole( 'tab' )[ 0 ] );
			expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
				'http://localhost:9010/about/'
			);
		}
	}
);

it( 'opens the new-tab menu with the primary T shortcut, including from closed preview', async () => {
	const { user } = await setup();
	const button = screen.getByRole( 'button', { name: 'New tab' } );
	expect( button ).toHaveAttribute( 'aria-keyshortcuts' );
	await user.click( screen.getByRole( 'button', { name: 'Hide panel' } ) );
	const isApple = /Mac|iPhone|iPad/.test( navigator.platform );
	fireEvent.keyDown( document, { key: 't', code: 'KeyT', metaKey: isApple, ctrlKey: ! isApple } );
	await screen.findByRole( 'menuitem', { name: 'Browser' } );
	expect( screen.getByRole( 'button', { name: 'Hide panel' } ) ).toBeVisible();
	await user.keyboard( '{Escape}' );
	fireEvent.keyDown( document, {
		key: 't',
		code: 'KeyT',
		metaKey: isApple,
		ctrlKey: ! isApple,
		shiftKey: true,
	} );
	expect( screen.queryByRole( 'menuitem', { name: 'Browser' } ) ).not.toBeInTheDocument();
} );

it.each( [ 'composer', 'sidebar', 'palette' ] )(
	'loads the normal project preview when restarted after closing the last tab from %s',
	async ( control ) => {
		const { connector } = await setup();
		fireEvent.click( screen.getByRole( 'button', { name: 'Close First' } ) );
		await screen.findByRole( 'button', { name: 'Start First' } );
		let resume!: () => void;
		const ready = new Promise< void >( ( resolve ) => {
			resume = resolve;
		} );
		const start = connector.startSite.getMockImplementation()!;
		connector.startSite.mockImplementation( async ( id ) => {
			await ready;
			return start( id );
		} );
		if ( control === 'sidebar' ) {
			fireEvent.click( screen.getByRole( 'button', { name: 'Start First' } ) );
		} else if ( control === 'composer' ) {
			fireEvent.change( screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } ), {
				target: { value: '' },
			} );
			fireEvent.click( await screen.findByRole( 'button', { name: 'Start site' } ) );
		} else {
			const isApple = /Mac|iPhone|iPad/.test( navigator.platform );
			fireEvent.keyDown( document, {
				key: 'k',
				code: 'KeyK',
				metaKey: isApple,
				ctrlKey: ! isApple,
			} );
			fireEvent.change( await screen.findByLabelText( 'Search commands' ), {
				target: { value: 'Start site' },
			} );
			fireEvent.click( await screen.findByRole( 'option', { name: /^Start site/ } ) );
		}
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
		await act( async () => {
			resume();
			await ready;
		} );
		await waitFor( () => expect( document.querySelector( 'iframe' ) ).not.toBeNull() );
		expect( screen.queryByRole( 'tab', { name: 'New tab' } ) ).not.toBeInTheDocument();
		fireEvent.load( document.querySelector( 'iframe' )! );
		await screen.findByRole( 'tab', { name: 'First' } );
		expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 1 );
		expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
			'http://localhost:9010'
		);
	}
);

function tabPointer( type: string, x: number, y = 26, pointerId = 1 ) {
	const event = new MouseEvent( type, {
		bubbles: true,
		cancelable: true,
		button: 0,
		clientX: x,
		clientY: y,
	} );
	Object.defineProperty( event, 'pointerId', { value: pointerId } );
	return event;
}
async function sortableTabs() {
	await setup();
	for ( const name of [ 'Admin', 'Database' ] ) {
		fireEvent.click( screen.getByRole( 'button', { name: 'New tab' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name } ) );
		await waitFor( () => expect( selectedTab() ).toHaveFocus() );
	}
	const tabs = screen.getAllByRole( 'tab' );
	const list = screen.getByRole( 'tablist', { name: 'Preview tabs' } );
	tabs.forEach( ( tab ) => {
		const row = tab.closest< HTMLElement >( '[data-tab-reorder-id]' )!;
		vi.spyOn( row, 'getBoundingClientRect' ).mockImplementation(
			() =>
				new DOMRect(
					20 + Array.from( list.querySelectorAll( '[data-tab-reorder-id]' ) ).indexOf( row ) * 162,
					10,
					160,
					32
				)
		);
	} );
	vi.spyOn(
		screen.getByRole( 'tablist', { name: 'Preview tabs' } ),
		'getBoundingClientRect'
	).mockReturnValue( new DOMRect( 20, 10, 484, 32 ) );
	return tabs;
}
it( 'lets the only browser tab be picked up without changing its page or selection', async () => {
	await setup();
	const tab = selectedTab();
	const page = document.querySelector( 'iframe' );
	fireEvent( tab, tabPointer( 'pointerdown', 40 ) );
	fireEvent( window, tabPointer( 'pointermove', 200, 100 ) );
	expect( document.querySelector( '[data-tab-drag-preview]' ) ).toHaveTextContent( 'First' );
	fireEvent( window, tabPointer( 'pointerup', 200, 100 ) );
	await waitFor( () => expect( document.querySelector( '[data-tab-drag-preview]' ) ).toBeNull() );
	expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 1 );
	expect( selectedTab() ).toBe( tab );
	expect( document.querySelector( 'iframe' ) ).toBe( page );
} );
it( 'leaves normal clicks uncaptured until a drag starts', async () => {
	const tabs = await sortableTabs();
	const list = screen.getByRole( 'tablist', { name: 'Preview tabs' } );
	const capture = vi.fn();
	Object.defineProperty( list, 'setPointerCapture', { value: capture, configurable: true } );
	fireEvent( tabs[ 0 ], tabPointer( 'pointerdown', 40 ) );
	fireEvent( window, tabPointer( 'pointermove', 42 ) );
	expect( capture ).not.toHaveBeenCalled();
	fireEvent( tabs[ 0 ], tabPointer( 'pointerup', 42 ) );
	fireEvent.click( tabs[ 0 ] );
	expect( selectedTab() ).toBe( tabs[ 0 ] );
	fireEvent( tabs[ 0 ], tabPointer( 'pointerdown', 40 ) );
	fireEvent( window, tabPointer( 'pointermove', 440 ) );
	expect( capture ).toHaveBeenCalledWith( 1 );
	fireEvent( window, tabPointer( 'pointercancel', 440 ) );
} );
it( 'leaves touch swipes available for scrolling rather than reordering', async () => {
	const tabs = await sortableTabs();
	const down = tabPointer( 'pointerdown', 40 );
	Object.defineProperty( down, 'pointerType', { value: 'touch' } );
	fireEvent( tabs[ 0 ], down );
	fireEvent( window, tabPointer( 'pointermove', 440 ) );
	fireEvent( window, tabPointer( 'pointerup', 440 ) );
	expect( document.querySelector( '[data-tab-drag-preview]' ) ).toBeNull();
	expect( screen.getAllByRole( 'tab' ) ).toEqual( tabs );
} );
it( 'moves neighboring tabs aside with one opaque drag chip and preserves pages after dropping', async () => {
	const tabs = await sortableTabs();
	const pages = Array.from( document.querySelectorAll( 'iframe' ) );
	const first = tabs[ 0 ].closest< HTMLElement >( '[data-tab-reorder-id]' )!;
	document.documentElement.style.setProperty( '--motion-duration-surface', '180ms' );
	fireEvent( tabs[ 0 ], tabPointer( 'pointerdown', 40 ) );
	fireEvent( window, tabPointer( 'pointermove', 42 ) );
	expect( document.querySelector( '[data-tab-drag-preview]' ) ).toBeNull();
	fireEvent( window, tabPointer( 'pointermove', 440 ) );
	expect( document.querySelectorAll( '[data-tab-drag-preview]' ) ).toHaveLength( 1 );
	expect( first ).toHaveAttribute( 'data-drag-source' );
	expect( tabs[ 1 ].parentElement ).toHaveStyle( { transform: 'translateX(-162px)' } );
	expect( tabs[ 2 ].parentElement ).toHaveStyle( { transform: 'translateX(-162px)' } );
	fireEvent( window, tabPointer( 'pointerup', 440 ) );
	await waitFor( () =>
		expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [
			'Admin',
			'Database',
			'First',
		] )
	);
	await waitFor( () => expect( document.querySelector( '[data-tab-drag-preview]' ) ).toBeNull() );
	expect( selectedTab() ).toHaveTextContent( 'Database' );
	expect( new Set( document.querySelectorAll( 'iframe' ) ) ).toEqual( new Set( pages ) );
	expect( screen.getByText( 'First moved to position 3 of 3' ) ).toBeInTheDocument();
} );
it.each( [
	{ x: -1000, y: -1000 },
	{ x: 2000, y: 2000 },
	{ x: 300, y: 200 },
] )( 'follows the pointer without window bounds at $x, $y', async ( { x, y } ) => {
	const tabs = await sortableTabs();
	fireEvent( tabs[ 0 ], tabPointer( 'pointerdown', 40 ) );
	fireEvent( window, tabPointer( 'pointermove', x, y ) );
	const left = x - 20;
	const top = y - 16;
	expect( document.querySelector( '[data-tab-drag-preview]' ) ).toHaveStyle( {
		transform: `translate3d(${ left }px, ${ top }px, 0)`,
	} );
	fireEvent( window, tabPointer( 'pointercancel', x, y ) );
} );
it.each( [ 'escape', 'cancel' ] )( 'cancels tab sorting on %s', async ( reason ) => {
	const tabs = await sortableTabs();
	fireEvent( tabs[ 0 ], tabPointer( 'pointerdown', 40 ) );
	fireEvent( window, tabPointer( 'pointermove', 440 ) );
	if ( reason === 'escape' ) fireEvent.keyDown( window, { key: 'Escape' } );
	else fireEvent( window, tabPointer( 'pointercancel', 440 ) );
	await waitFor( () => expect( document.querySelector( '[data-tab-drag-preview]' ) ).toBeNull() );
	expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [
		'First',
		'Admin',
		'Database',
	] );
} );
it( 'keeps the reordered position when released below the tab row', async () => {
	const tabs = await sortableTabs();
	fireEvent( tabs[ 0 ], tabPointer( 'pointerdown', 40 ) );
	fireEvent( window, tabPointer( 'pointermove', 440, 200 ) );
	expect( tabs[ 1 ].parentElement ).toHaveStyle( { transform: 'translateX(-162px)' } );
	fireEvent( window, tabPointer( 'pointerup', 440, 200 ) );
	expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [
		'Admin',
		'Database',
		'First',
	] );
	await waitFor( () => expect( document.querySelector( '[data-tab-drag-preview]' ) ).toBeNull() );
} );
it( 'keeps close controls separate from drag and supports keyboard reordering', async () => {
	const tabs = await sortableTabs();
	const close = screen.getByRole( 'button', { name: 'Close First' } );
	fireEvent( close, tabPointer( 'pointerdown', 155 ) );
	fireEvent( window, tabPointer( 'pointermove', 440 ) );
	expect( document.querySelector( '[data-tab-drag-preview]' ) ).toBeNull();
	fireEvent.click( tabs[ 0 ] );
	fireEvent.keyDown( tabs[ 0 ], { key: 'ArrowRight', altKey: true, shiftKey: true } );
	await waitFor( () => expect( screen.getAllByRole( 'tab' )[ 1 ] ).toHaveFocus() );
	expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [
		'Admin',
		'First',
		'Database',
	] );
	expect( selectedTab() ).toHaveTextContent( 'First' );
	fireEvent.click( close );
	expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [
		'Admin',
		'Database',
	] );
} );

it( 'commits a dropped order before another drag interrupts its landing', async () => {
	const tabs = await sortableTabs();
	document.documentElement.style.setProperty( '--motion-duration-surface', '180ms' );
	fireEvent( tabs[ 0 ], tabPointer( 'pointerdown', 40 ) );
	fireEvent( window, tabPointer( 'pointermove', 440 ) );
	fireEvent( window, tabPointer( 'pointerup', 440 ) );
	expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [
		'Admin',
		'Database',
		'First',
	] );
	const admin = screen.getByRole( 'tab', { name: 'Admin' } );
	fireEvent( admin, tabPointer( 'pointerdown', 40 ) );
	fireEvent( window, tabPointer( 'pointermove', 440 ) );
	fireEvent( window, tabPointer( 'pointerup', 440 ) );
	await waitFor( () => expect( document.querySelector( '[data-tab-drag-preview]' ) ).toBeNull() );
	expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [
		'Database',
		'First',
		'Admin',
	] );
} );

it( 'selects an existing project tab when reviewing a note on its page', async () => {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', name: 'First', running: true } ) ],
		user: TEST_USER,
	} );
	connector.capabilities.annotatePreview = true;
	renderApp( { connector, path: '/sites/one/new' } );
	await screen.findByRole( 'button', { name: 'Site menu' } );
	if ( screen.queryByRole( 'button', { name: 'Show panel' } ) )
		fireEvent.click( screen.getByRole( 'button', { name: 'Show panel' } ) );
	const go = async ( path: string ) => {
		const input = screen.getByRole( 'textbox', { name: 'Address' } );
		fireEvent.change( input, { target: { value: path } } );
		fireEvent.submit( input.closest( 'form' )! );
	};
	await go( '/about/' );
	await newBrowserTab();
	await go( '/other/' );
	let id = '';
	act( () => {
		setAnnotating( 'one', true );
		id = pickAnnotation( 'one', { selector: 'h1', path: '/about/' } )!;
		changeAnnotation( 'one', id, { comment: 'Fix this title' } );
		stageAnnotations( 'one', [ id ], true );
		setAnnotating( 'one', false );
	} );
	fireEvent.click( await screen.findByRole( 'button', { name: '1 annotation' } ) );
	fireEvent.click(
		await screen.findByRole( 'button', { name: 'Edit annotation 1: Fix this title' } )
	);
	await waitFor( () =>
		expect( screen.getAllByRole( 'tab' )[ 0 ] ).toHaveAttribute( 'aria-selected', 'true' )
	);
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
		'http://localhost:9010/about/'
	);
	expect( getSiteAnnotations( 'one' ).editingId ).toBe( id );
	let draft = '';
	act( () => {
		draft = pickAnnotation( 'one', { selector: 'p', path: '/about/' } )!;
		changeAnnotation( 'one', draft, { comment: 'Finish this note first' } );
		setAnnotating( 'one', false );
	} );
	fireEvent.click( screen.getByRole( 'button', { name: '1 annotation' } ) );
	fireEvent.click( screen.getByRole( 'button', { name: 'Edit annotation 1: Fix this title' } ) );
	expect( getSiteAnnotations( 'one' ).editingId ).toBe( draft );
	expect( getSiteAnnotations( 'one' ).active ).toBe( true );
	expect( getSiteAnnotations( 'one' ).notes ).toHaveLength( 2 );
} );

it( 'reopens a batched design note in its existing tab without scrolling', async () => {
	const { connector, queryClient, user } = await setup( true, true );
	const design = {
		design:
			'---\nname: First\ncolors:\n  primary: "#3858e9"\n  background: "#ffffff"\ntypography:\n  body:\n    fontFamily: "Inter"\n---',
		themeJson: {},
	};
	connector.getSiteDesign.mockResolvedValue( design );
	await act( () => queryClient.setQueryData( [ 'site-design', 'one' ], design ) );
	await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Design system' } ) );
	await waitFor( () => expect( selectedTab() ).toHaveFocus() );
	let id = '';
	act( () => {
		setAnnotating( 'one', true );
		id = pickAnnotation( 'one', { targetKey: 'name', path: 'DESIGN.md' } )!;
		changeAnnotation( 'one', id, { comment: 'Give this title more space' } );
		stageAnnotations( 'one', [ id ], true );
		setAnnotating( 'one', false );
	} );
	await newBrowserTab();
	await user.click( screen.getByRole( 'button', { name: '1 annotation' } ) );
	await user.click(
		screen.getByRole( 'button', { name: 'Edit annotation 1: Give this title more space' } )
	);
	expect( screen.getByRole( 'tab', { name: 'Design system' } ) ).toHaveAttribute(
		'aria-selected',
		'true'
	);
	expect( await screen.findByRole( 'textbox', { name: 'Describe the change' } ) ).toHaveValue(
		'Give this title more space'
	);
} );

it( 'opens a WordPress style board without DESIGN.md and reloads saved style changes', async () => {
	const { connector, queryClient, user } = await setup();
	const board = ( color: string ) => ( {
		design: null,
		themeJson: {
			settings: {
				color: {
					palette: {
						theme: [
							{ slug: 'ink', color: '#111111' },
							{ slug: 'base', color: '#ffffff' },
							{ slug: 'accent', color },
						],
					},
				},
			},
			styles: { typography: { fontFamily: 'Inter, sans-serif' } },
		},
	} );
	connector.getSiteDesign.mockResolvedValue( board( '#123456' ) );
	await act( () => queryClient.invalidateQueries( { queryKey: [ 'site-design', 'one' ] } ) );
	await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Design system' } ) );
	expect( await screen.findByRole( 'heading', { name: 'Color' } ) ).toBeVisible();
	expect( screen.getByText( '#123456' ) ).toBeVisible();
	expect( screen.queryByText( /DESIGN.md/ ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeDisabled();
	connector.getSiteDesign.mockResolvedValue( board( '#654321' ) );
	await user.click( screen.getByRole( 'button', { name: 'Reload preview' } ) );
	expect( await screen.findByText( '#654321' ) ).toBeVisible();
	expect( screen.queryByText( '#123456' ) ).not.toBeInTheDocument();
} );

it.each( [ 'Admin', 'Database', 'Email log' ] )(
	'keeps the current tab when opening %s from the site menu',
	async ( name ) => {
		const { user } = await setup();
		const originalTab = selectedTab();
		await user.click( screen.getByRole( 'button', { name: 'Site menu' } ) );
		await user.click( await screen.findByRole( 'menuitem', { name: 'Tools' } ) );
		await screen.findByRole( 'menuitem', { name } );
		await user.keyboard( name[ 0 ].toLowerCase() );
		await waitFor( () => expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 2 ) );
		expect( originalTab ).toBeInTheDocument();
		expect( screen.getByRole( 'tab', { name } ) ).toHaveAttribute( 'aria-selected', 'true' );
	}
);
