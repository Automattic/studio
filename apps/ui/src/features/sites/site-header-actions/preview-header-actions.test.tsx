import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { markPreviewReady } from '@/data/preview-ready';
import { applySyncActivity } from '@/data/sync-activity';
import { SessionUIProvider } from '@/data/use-session-ui';
import { setAnnotating } from '@/features/annotations';
import { SitePreview } from '@/features/sites/site-preview';
import { SiteRunButton } from '@/features/sites/site-run-button';
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
	withChatControls = false,
	running = true
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
	const site = makeSite( { id: siteId, running } );
	connector.state.sites = [ site ];
	const view = renderWithProviders(
		<SiteHeaderActionsProvider host="preview">
			<SessionUIProvider>
				<SitePreview
					site={ site }
					path="/"
					reloadNonce={ 0 }
					toolbarStart={ withChatControls ? <SiteRunButton site={ site } /> : undefined }
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
	await resize( 600 );
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
	const { user } = await renderHeader( 'annotate-site', createFakeConnector(), 600, true );
	await act( async () => {
		document
			.querySelector< HTMLElement >( '[data-site-header]' )!
			.style.setProperty( '--preview-header-content-width', '400px' );
	} );
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
	const { user } = await renderHeader( 'navigation-site', connector );
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
		[ 'Open in browser', () => expect( connector.openSiteUrl ).toHaveBeenCalledOnce() ],
	] as const;
	for ( const [ name, effect ] of effects ) {
		await user.click( screen.getByRole( 'button', { name: 'More preview actions' } ) );
		expect( await screen.findByRole( 'menuitem', { name: /^Back/ } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.queryByRole( 'menuitem', { name: 'Site settings' } ) ).not.toBeInTheDocument();
		expect(
			Array.from( screen.getByRole( 'menu' ).querySelectorAll( '[role^="menuitem"]' ) ).map(
				( item ) => item.textContent
			)
		).toEqual( [
			'Stop site',
			'Share',
			'Annotate',
			'Responsive mode',
			'Go to URL…',
			'Open in browser',
			expect.stringMatching( /^Back/ ),
			expect.stringMatching( /^Forward/ ),
			'Reload preview',
		] );
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
	await user.click( screen.getByRole( 'button', { name: 'More preview actions' } ) );
	const activeToggle = await screen.findByRole( 'menuitemcheckbox', { name: 'Responsive mode' } );
	expect( activeToggle ).toBeChecked();
	await user.click( activeToggle );
	expect( screen.queryByRole( 'toolbar', { name: 'Responsive preview' } ) ).not.toBeInTheDocument();
	await resize( 1000 );
	expect( screen.getByRole( 'button', { name: 'Responsive mode' } ) ).toHaveAttribute(
		'aria-pressed',
		'false'
	);
} );

it( 'moves Annotate into More only at mobile widths and restores it', async () => {
	const { resize } = await renderHeader( 'mobile-annotate', createFakeConnector(), 600, true );
	expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeVisible();
	await resize( 390 );
	expect( screen.queryByRole( 'button', { name: 'Annotate' } ) ).not.toBeInTheDocument();
	fireEvent.click( screen.getByRole( 'button', { name: 'More preview actions' } ) );
	expect( await screen.findByRole( 'menuitemcheckbox', { name: 'Annotate' } ) ).not.toBeChecked();
	fireEvent.keyDown( screen.getByRole( 'menu' ), { key: 'Escape' } );
	await resize( 600 );
	expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeVisible();
} );

it.each( [ true, false ] )(
	'moves the site run control into More on mobile (running: %s)',
	async ( running ) => {
		const label = running ? 'Stop site' : 'Start site';
		const { user, resize } = await renderHeader(
			'mobile-run',
			createFakeConnector(),
			600,
			true,
			running
		);
		const button = screen.getByRole( 'button', { name: label } );
		button.focus();
		await resize( 540 );
		expect( screen.queryByRole( 'button', { name: label } ) ).not.toBeInTheDocument();
		const more = screen.getByRole( 'button', { name: 'More preview actions' } );
		expect( more ).toHaveFocus();
		await user.click( more );
		expect( await screen.findByRole( 'menuitem', { name: label } ) ).not.toHaveAttribute(
			'aria-disabled',
			'true'
		);
		await user.keyboard( '{Escape}' );
		await resize( 541 );
		expect( screen.getByRole( 'button', { name: label } ) ).toBeVisible();
	}
);

it( 'moves URL navigation into More on mobile', async () => {
	const { user, resize } = await renderHeader( 'mobile-address', createFakeConnector(), 600 );
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
	await resize( 540 );
	expect( screen.queryByRole( 'textbox', { name: 'Address' } ) ).not.toBeInTheDocument();
	const more = screen.getByRole( 'button', { name: 'More preview actions' } );
	await user.click( more );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Go to URL…' } ) );
	expect( await screen.findByRole( 'dialog', { name: 'Go to URL' } ) ).toBeVisible();
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
	await user.click( screen.getByRole( 'button', { name: 'Close' } ) );
	await resize( 600 );
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
} );
