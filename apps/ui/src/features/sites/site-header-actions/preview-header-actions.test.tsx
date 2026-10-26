import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { markPreviewReady } from '@/data/preview-ready';
import { applySyncActivity } from '@/data/sync-activity';
import { SessionUIProvider } from '@/data/use-session-ui';
import { setAnnotating } from '@/features/annotations';
import { SitePreview } from '@/features/sites/site-preview';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SiteHeaderActions, SiteHeaderActionsProvider } from './index';

const REAL_USER_AGENT = window.navigator.userAgent;

afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	Object.defineProperty( window.navigator, 'userAgent', {
		value: REAL_USER_AGENT,
		configurable: true,
	} );
} );

async function renderHeader( siteId: string, connector = createFakeConnector() ) {
	Object.defineProperty( window.navigator, 'userAgent', {
		value: `${ REAL_USER_AGENT } Electron/38.0.0`,
		configurable: true,
	} );
	vi.stubGlobal( 'ipcApi', { clearWebviewCache: vi.fn( async () => {} ) } );
	vi.spyOn( HTMLElement.prototype, 'getBoundingClientRect' ).mockReturnValue( {
		width: 40,
	} as DOMRect );
	vi.spyOn( HTMLElement.prototype, 'clientWidth', 'get' ).mockImplementation( function (
		this: HTMLElement
	) {
		return this.hasAttribute( 'data-site-header' ) ? 60 : 0;
	} );
	const site = makeSite( { id: siteId, running: true } );
	connector.state.sites = [ site ];
	const view = renderWithProviders(
		<SiteHeaderActionsProvider host="preview">
			<SessionUIProvider>
				<SitePreview site={ site } path="/" reloadNonce={ 0 } />
				<SiteHeaderActions site={ site } />
			</SessionUIProvider>
		</SiteHeaderActionsProvider>,
		{ connector }
	);
	await screen.findByRole( 'complementary', { name: 'Site preview' } );
	return view;
}

const headerButtons = ( name: string | RegExp ) =>
	[ '[data-site-header]', '[data-site-header-actions]' ].flatMap( ( selector ) =>
		within( document.querySelector< HTMLElement >( selector )! ).queryAllByRole( 'button', {
			name,
		} )
	);

function readyGuest( extra: Record< string, unknown > = {} ) {
	const webview = document.querySelector( 'webview' ) as HTMLElement;
	Object.assign( webview, {
		executeJavaScript: vi.fn( async () => '' ),
		getWebContentsId: () => 7,
		loadURL: vi.fn( async () => {} ),
		reload: vi.fn(),
		...extra,
	} );
	fireEvent( webview, new Event( 'dom-ready' ) );
	return webview as HTMLElement & Record< string, ReturnType< typeof vi.fn > >;
}

it( 'keeps icon-only annotation available beside overflow with sharing feedback', async () => {
	setAnnotating( 'annotate-site', true );
	const { user } = await renderHeader( 'annotate-site' );
	const webview = readyGuest();
	const more = screen.getByRole( 'button', { name: 'More preview actions' } );
	const annotation = screen.getByRole( 'button', { name: 'Annotate' } );
	await waitFor( () => expect( annotation ).toBeEnabled() );
	expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
	expect( headerButtons( /^Send/ ) ).toHaveLength( 0 );
	expect( annotation ).toHaveAttribute( 'aria-pressed', 'true' );
	expect( annotation ).toHaveTextContent( '' );
	await user.click( annotation );
	expect( annotation ).toHaveAttribute( 'aria-pressed', 'false' );
	act( () => {
		applySyncActivity( 'annotate-site', { kind: 'pending', direction: 'preview' } );
	} );
	expect( more ).toHaveAttribute(
		'aria-description',
		expect.stringContaining( 'Publishing preview' )
	);
	act( () => {
		applySyncActivity( 'annotate-site', { kind: 'success', direction: 'preview' } );
		markPreviewReady( 'annotate-site' );
	} );
	expect( more.querySelector( '[data-slot="notification-dot"]' ) ).toBeInTheDocument();
	await user.click( more );
	await user.click( await screen.findByRole( 'menuitem', { name: /^Share/ } ) );
	expect( await screen.findByRole( 'dialog' ) ).toBeInTheDocument();
	await user.keyboard( '{Escape}' );
	fireEvent(
		webview,
		Object.assign( new Event( 'did-start-navigation' ), { isMainFrame: true, isInPlace: false } )
	);
	expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeDisabled();
	await user.click( more );
	expect( screen.queryByRole( 'menuitemcheckbox', { name: 'Annotate' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeInTheDocument();
	expect( headerButtons( 'Send 1 annotation' ) ).toHaveLength( 0 );
} );

it( 'exposes browser actions with their navigation availability in overflow', async () => {
	const connector = createFakeConnector();
	const { history, user } = await renderHeader( 'navigation-site', connector );
	const webview = readyGuest( {
		canGoBack: () => false,
		canGoForward: () => true,
		goForward: vi.fn(),
	} );
	fireEvent(
		webview,
		Object.assign( new Event( 'did-navigate' ), { url: 'http://localhost:9010/' } )
	);
	const effects = [
		[ 'Forward', () => expect( webview.goForward ).toHaveBeenCalledOnce() ],
		[ 'Reload preview', () => expect( webview.reload ).toHaveBeenCalledOnce() ],
		[ 'Site settings', () => expect( history.location.search ).toContain( 'settings=site' ) ],
		[ 'Open in browser', () => expect( connector.openSiteUrl ).toHaveBeenCalledOnce() ],
	] as const;
	for ( const [ name, effect ] of effects ) {
		await user.click( screen.getByRole( 'button', { name: 'More preview actions' } ) );
		expect( await screen.findByRole( 'menuitem', { name: /^Back/ } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		await user.click( screen.getByRole( 'menuitem', { name: new RegExp( `^${ name }` ) } ) );
		await waitFor( effect );
	}
} );
