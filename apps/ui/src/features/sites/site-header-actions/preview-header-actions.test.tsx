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

async function renderHeader(
	siteId: string,
	connector = createFakeConnector(),
	width = 60,
	withChatControls = false
) {
	Object.defineProperty( window.navigator, 'userAgent', {
		value: `${ REAL_USER_AGENT } Electron/38.0.0`,
		configurable: true,
	} );
	vi.stubGlobal( 'ipcApi', { clearWebviewCache: vi.fn( async () => {} ) } );
	vi.spyOn( HTMLElement.prototype, 'getBoundingClientRect' ).mockImplementation( function (
		this: HTMLElement
	) {
		return {
			width:
				this.hasAttribute( 'data-site-header-navigation' ) &&
				this.getAttribute( 'aria-hidden' ) === 'true'
					? 0
					: 40,
		} as DOMRect;
	} );
	vi.spyOn( HTMLElement.prototype, 'clientWidth', 'get' ).mockImplementation( function (
		this: HTMLElement
	) {
		return this.hasAttribute( 'data-site-header' ) ? width : 0;
	} );
	const site = makeSite( { id: siteId, running: true } );
	connector.state.sites = [ site ];
	const view = renderWithProviders(
		<SiteHeaderActionsProvider host="preview">
			<SessionUIProvider>
				<SitePreview
					site={ site }
					path="/"
					reloadNonce={ 0 }
					toolbarStart={ withChatControls ? <span>Chat controls</span> : undefined }
				/>
				<SiteHeaderActions site={ site } />
			</SessionUIProvider>
		</SiteHeaderActionsProvider>,
		{ connector }
	);
	await screen.findByRole( 'complementary', { name: 'Site preview' } );
	return {
		...view,
		resize: ( next: number ) =>
			act( async () => {
				width = next;
				document
					.querySelector( '[data-site-header]' )!
					.setAttribute( 'data-width', String( next ) );
			} ),
	};
}

const headerButtons = ( name: string | RegExp ) =>
	[ '[data-site-header]', '[data-site-header-actions]' ].flatMap( ( selector ) =>
		within( document.querySelector< HTMLElement >( selector )! ).queryAllByRole( 'button', {
			name,
		} )
	);

it( 'compacts the header before moving navigation into More and restores each stage', async () => {
	const { resize } = await renderHeader( 'compact-chat-header', createFakeConnector(), 1000, true );
	const header = document.querySelector< HTMLElement >( '[data-site-header]' )!;
	await act( async () => {
		header.style.setProperty( '--preview-header-content-width', '400px' );
	} );
	await resize( 850 );
	expect( header ).toHaveAttribute( 'data-site-header-layout', 'actions-overflow' );
	expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toHaveTextContent( '' );
	expect( screen.getByRole( 'button', { name: 'More preview actions' } ) ).toBeVisible();
	await resize( 740 );
	expect( header ).toHaveAttribute( 'data-site-header-layout', 'actions-overflow' );
	expect( screen.getByRole( 'button', { name: 'Reload preview' } ) ).toBeVisible();
	await resize( 300 );
	expect( header ).toHaveAttribute( 'data-site-header-layout', 'navigation-overflow' );
	expect( screen.queryByRole( 'button', { name: 'Reload preview' } ) ).not.toBeInTheDocument();
	await resize( 740 );
	expect( header ).toHaveAttribute( 'data-site-header-layout', 'actions-overflow' );
	await resize( 1000 );
	expect( header ).toHaveAttribute( 'data-site-header-layout', 'inline' );
} );

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
		expect.stringContaining( 'Creating preview' )
	);
	act( () => {
		applySyncActivity( 'annotate-site', { kind: 'success', direction: 'preview' } );
		markPreviewReady( 'annotate-site' );
	} );
	expect( more ).toHaveAttribute( 'aria-description', 'Preview ready' );
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

it( 'moves responsive mode into More with its state and restores the inline control when it fits', async () => {
	const { user, resize } = await renderHeader( 'responsive-overflow', createFakeConnector(), 1000 );
	const toggle = screen.getByRole( 'button', { name: 'Responsive mode' } );
	toggle.focus();
	await resize( 320 );
	const more = screen.getByRole( 'button', { name: 'More preview actions' } );
	expect( more ).toHaveFocus();
	expect( screen.queryByRole( 'button', { name: 'Responsive mode' } ) ).not.toBeInTheDocument();
	await user.click( more );
	const item = await screen.findByRole( 'menuitemcheckbox', { name: 'Responsive mode' } );
	expect( item ).not.toBeChecked();
	await user.click( item );
	expect(
		await screen.findByRole( 'toolbar', { name: 'Responsive preview' } )
	).toBeInTheDocument();
	const activeToggle = screen.getByRole( 'button', { name: 'Responsive mode' } );
	expect( activeToggle ).toHaveAttribute( 'aria-pressed', 'true' );
	expect( screen.getByRole( 'textbox', { name: 'Address' } ).closest( 'form' ) ).toContainElement(
		activeToggle
	);
	await user.click( activeToggle );
	expect( screen.queryByRole( 'toolbar', { name: 'Responsive preview' } ) ).not.toBeInTheDocument();
	await resize( 1000 );
	expect( screen.getByRole( 'button', { name: 'Responsive mode' } ) ).toHaveAttribute(
		'aria-pressed',
		'false'
	);
} );
