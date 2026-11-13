import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { applySyncActivity } from '@/data/sync-activity';
import { SessionUIProvider } from '@/data/use-session-ui';
import {
	changeAnnotation,
	removeAnnotations,
	pickAnnotation,
	setAnnotating,
	stageAnnotations,
} from '@/features/annotations';
import { SessionHeader } from '@/features/chats';
import { HeaderSidebarToggle } from '@/features/sidebar';
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
	width = 1000,
	running = true,
	onSendAnnotations = vi.fn()
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
		return this.hasAttribute( 'data-preview-browser-controls' ) ? width : 1000;
	} );
	vi.stubGlobal( 'innerWidth', 1024 );
	const site = makeSite( { id: siteId, running } );
	connector.state.sites = [ site ];
	const view = renderWithProviders(
		<SiteHeaderActionsProvider host="panel">
			<SessionUIProvider>
				<SessionHeader site={ site } start={ <HeaderSidebarToggle /> } />
				<SitePreview
					site={ site }
					path="/"
					reloadNonce={ 0 }
					onSendAnnotations={ onSendAnnotations }
				/>
				<SiteHeaderActions site={ site } />
			</SessionUIProvider>
		</SiteHeaderActionsProvider>,
		{ connector }
	);
	await screen.findByRole( 'complementary', { name: 'Panel' } );
	return {
		...view,
		resize: ( next: number, windowWidth = next ) =>
			act( async () => {
				width = next;
				vi.stubGlobal( 'innerWidth', windowWidth );
				window.dispatchEvent( new Event( 'resize' ) );
				document
					.querySelector( '[data-preview-browser-controls]' )!
					.setAttribute( 'data-width', String( next ) );
			} ),
	};
}

const headerButtons = ( name: string | RegExp ) =>
	within( document.querySelector< HTMLElement >( '[data-site-header-actions]' )! ).queryAllByRole(
		'button',
		{ name }
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

it( 'keeps icon-only annotation available with publishing feedback', async () => {
	setAnnotating( 'annotate-site', true );
	const { user } = await renderHeader( 'annotate-site', createFakeConnector(), 600 );
	const webview = readyGuest();
	expect(
		screen.queryByRole( 'button', { name: 'More preview actions' } )
	).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'Share' } ) ).not.toBeInTheDocument();
	const publish = screen.getByRole( 'button', { name: /^(Share|Publish)…$/ } );
	const annotation = screen.getByRole( 'button', { name: 'Annotate' } );
	await waitFor( () => expect( annotation ).toBeEnabled() );
	expect( screen.getByRole( 'button', { name: /^(Share|Publish)…$/ } ) ).toBeVisible();
	expect( headerButtons( /^Send/ ) ).toHaveLength( 0 );
	expect( annotation ).toHaveAttribute( 'aria-pressed', 'true' );
	expect( screen.getByRole( 'button', { name: /^(Share|Publish)…$/ } ) ).toHaveAttribute(
		'data-variant',
		'accent'
	);
	expect( screen.getByRole( 'button', { name: /^(Share|Publish)…$/ } ) ).toBeEnabled();
	expect( annotation ).toHaveTextContent( /^$/ );
	await user.click( annotation );
	expect( annotation ).toHaveAttribute( 'aria-pressed', 'false' );
	expect( screen.getByRole( 'button', { name: /^(Share|Publish)…$/ } ) ).toHaveAttribute(
		'data-variant',
		'accent'
	);
	act( () => {
		applySyncActivity( 'annotate-site', { kind: 'pending', direction: 'preview' } );
	} );
	expect( publish ).toHaveAttribute( 'aria-description', expect.stringContaining( 'Publishing' ) );
	act( () => {
		applySyncActivity( 'annotate-site', { kind: 'success', direction: 'preview' } );
	} );
	expect( publish ).not.toHaveAttribute( 'aria-description' );
	expect( publish.querySelector( '[data-slot="notification-dot"]' ) ).not.toBeInTheDocument();
	expect( publish ).toHaveTextContent( 'Share' );
	await user.click( publish );
	expect( await screen.findByRole( 'dialog' ) ).toBeInTheDocument();
	await user.keyboard( '{Escape}' );
	fireEvent(
		webview,
		Object.assign( new Event( 'did-start-navigation' ), { isMainFrame: true, isInPlace: false } )
	);
	expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeEnabled();
	expect( screen.queryByRole( 'menuitemcheckbox', { name: 'Annotate' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: /^(Share|Publish)…$/ } ) ).toBeInTheDocument();
	expect( headerButtons( 'Send 1 annotation' ) ).toHaveLength( 0 );
} );

it( 'marks saved annotations with a dot while keeping Share accented', async () => {
	const siteId = 'header-batch-site';
	const { user } = await renderHeader( siteId, createFakeConnector(), 1000, true, vi.fn() );
	readyGuest();
	const annotate = screen.getByRole( 'button', { name: 'Annotate' } );
	await waitFor( () => expect( annotate ).toBeEnabled() );
	let id = '';
	act( () => {
		setAnnotating( siteId, true );
		id = pickAnnotation( siteId, { selector: 'h1', tag: 'h1', path: '/' } )!;
		changeAnnotation( siteId, id, { comment: 'Make the heading smaller' } );
		stageAnnotations( siteId, [ id ], true );
		setAnnotating( siteId, false );
	} );
	expect( annotate.querySelector( '[data-slot="notification-dot"]' ) ).toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: /^(Share|Publish)…$/ } ) ).toHaveAttribute(
		'data-variant',
		'accent'
	);
	expect( annotate ).toHaveAccessibleDescription( '1 annotation ready to send' );
	expect( screen.queryByRole( 'button', { name: 'Send 1 annotation' } ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'Review annotations' } ) ).not.toBeInTheDocument();
	await user.click( annotate );
	expect( annotate ).toHaveAttribute( 'aria-pressed', 'true' );
	expect( annotate.querySelector( '[data-slot="notification-dot"]' ) ).not.toBeInTheDocument();
	await user.click( annotate );
	expect( annotate.querySelector( '[data-slot="notification-dot"]' ) ).toBeInTheDocument();
	act( () => {
		removeAnnotations( siteId, [ id ] );
		setAnnotating( siteId, false );
	} );
	expect( annotate ).not.toHaveTextContent( '1' );
} );

it( 'keeps browser actions directly available in a narrow preview', async () => {
	const connector = createFakeConnector();
	const { user, resize } = await renderHeader( 'navigation-site', connector, 360 );
	const openWebviewDevTools = vi.fn().mockResolvedValue( undefined );
	vi.stubGlobal( 'ipcApi', {
		clearWebviewCache: vi.fn( async () => {} ),
		openWebviewDevTools,
	} );
	await resize( 360, 1000 );
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
		[ 'Reload', () => expect( webview.reload ).toHaveBeenCalledOnce() ],
	] as const;
	for ( const [ name, effect ] of effects ) {
		expect(
			screen.queryByRole( 'button', { name: 'More preview actions' } )
		).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Back' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.queryByRole( 'menuitem', { name: 'Site settings' } ) ).not.toBeInTheDocument();

		await user.click( screen.getByRole( 'button', { name } ) );
		await waitFor( effect );
	}
	const options = screen.getByRole( 'button', { name: 'Browser options' } );
	await resize( 320 );
	expect( screen.getByRole( 'button', { name: 'Browser options' } ) ).toBe( options );
	options.focus();
	await user.keyboard( '{ArrowDown}' );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Developer tools' } ) );
	await waitFor( () => expect( openWebviewDevTools ).toHaveBeenCalledExactlyOnceWith( 7 ) );
} );

it( 'keeps the device toolbar available in browser options as the row compacts', async () => {
	const { user, resize } = await renderHeader( 'responsive-overflow', createFakeConnector(), 1000 );
	const options = screen.getByRole( 'button', { name: 'Browser options' } );
	options.focus();
	await user.keyboard( '{ArrowDown}' );
	await user.click( screen.getByRole( 'menuitem', { name: 'Show device toolbar' } ) );
	expect( screen.getByRole( 'toolbar', { name: 'Responsive preview' } ) ).toBeInTheDocument();
	await resize( 320 );
	expect( screen.getByRole( 'button', { name: 'Browser options' } ) ).toHaveFocus();
	await user.keyboard( '{ArrowDown}' );
	await waitFor( () =>
		expect( screen.getByRole( 'menuitem', { name: 'Hide device toolbar' } ) ).toHaveFocus()
	);
	await user.keyboard( '{ArrowDown}' );
	await waitFor( () =>
		expect( screen.getByRole( 'menuitem', { name: 'Annotate' } ) ).toHaveFocus()
	);
	await user.keyboard( '{Escape}' );
	expect( screen.getByRole( 'button', { name: 'Browser options' } ) ).toHaveFocus();
	expect(
		screen.queryByRole( 'button', { name: 'More preview actions' } )
	).not.toBeInTheDocument();
	await user.keyboard( '{ArrowDown}' );
	await user.click( screen.getByRole( 'menuitem', { name: 'Hide device toolbar' } ) );
	expect( screen.queryByRole( 'toolbar', { name: 'Responsive preview' } ) ).not.toBeInTheDocument();
	await resize( 1000 );
	expect( screen.getByRole( 'button', { name: 'Browser options' } ) ).toBeVisible();
} );

it( 'moves Annotate into browser options when its container narrows', async () => {
	const { resize, user } = await renderHeader( 'mobile-annotate', createFakeConnector(), 600 );
	expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeVisible();
	await resize( 390, 1000 );
	expect( screen.queryByRole( 'button', { name: 'Annotate' } ) ).not.toBeInTheDocument();
	await user.click( screen.getByRole( 'button', { name: 'Browser options' } ) );
	expect( await screen.findByRole( 'menuitem', { name: 'Annotate' } ) ).toBeInTheDocument();
	await user.keyboard( '{Escape}' );
	await resize( 600 );
	expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeVisible();
} );

it( 'keeps the annotation shortcut and menu action working in a narrow container', async () => {
	const { resize, user } = await renderHeader(
		'compact-annotation-shortcut',
		createFakeConnector(),
		600
	);
	readyGuest();
	await waitFor( () => expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeEnabled() );
	await resize( 390, 1000 );
	const isApple = /Mac|iPhone|iPad/.test( navigator.platform );
	fireEvent.keyDown( document, {
		key: '.',
		code: 'Period',
		shiftKey: true,
		metaKey: isApple,
		ctrlKey: ! isApple,
	} );
	await user.click( screen.getByRole( 'button', { name: 'Browser options' } ) );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Stop annotating' } ) );
	expect( screen.getByRole( 'button', { name: 'Annotate', hidden: true } ) ).toHaveAttribute(
		'aria-pressed',
		'false'
	);
} );

it( 'keeps site actions in the main header without mobile browser overflow', async () => {
	const { resize } = await renderHeader( 'mobile-run', createFakeConnector(), 1000 );
	const browser = screen.getByRole( 'toolbar', { name: 'Preview browser controls' } );
	const mainHeader = document.querySelector( '[data-site-header]' )!;
	const annotate = screen.getByRole( 'button', { name: 'Annotate' } );
	expect( screen.queryByRole( 'button', { name: 'Stop site' } ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'Share' } ) ).not.toBeInTheDocument();
	const publish = screen.getByRole( 'button', { name: /^(Share|Publish)…$/ } );
	expect( browser ).toContainElement( screen.getByRole( 'textbox', { name: 'Address' } ) );
	expect( mainHeader ).not.toContainElement( browser );
	expect( browser ).toContainElement( annotate );
	expect( document.querySelector( '[data-site-header-actions]' ) ).not.toContainElement( annotate );
	expect( browser ).not.toContainElement( publish );
	await resize( 540 );
	expect(
		screen.queryByRole( 'button', { name: 'More preview actions' } )
	).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'Stop site' } ) ).not.toBeInTheDocument();
	for ( const name of [ 'Back', 'Reload', 'Browser options' ] )
		expect( within( browser ).getByRole( 'button', { name } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Responsive mode' } ) ).not.toBeInTheDocument();
	await resize( 1000 );
	expect(
		screen.queryByRole( 'button', { name: 'More preview actions' } )
	).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: /^(Share|Publish)…$/ } ) ).toBe( publish );
} );

it( 'keeps URL navigation visible in a narrow container', async () => {
	const { resize } = await renderHeader( 'mobile-address', createFakeConnector(), 600 );
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
	await resize( 540 );
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
	await resize( 600 );
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
} );

it( 'hides browser controls and Annotate on a stopped preview', async () => {
	const connector = createFakeConnector();
	await renderHeader( 'annotate-stopped', connector, 1000, false );
	expect( screen.queryByRole( 'button', { name: 'Annotate' } ) ).not.toBeInTheDocument();
	expect(
		screen.queryByRole( 'toolbar', { name: 'Preview browser controls' } )
	).not.toBeInTheDocument();
	expect( connector.startSite ).not.toHaveBeenCalled();
} );

it.each( [ true, false ] )(
	'keeps Annotate visible when host support is %s',
	async ( annotatePreview ) => {
		const connector = createFakeConnector(
			{},
			{ capabilities: { nativeFolderPicker: true, annotatePreview, studioLogs: true } }
		);
		await renderHeader( 'annotate-capability', connector, 1000 );
		const annotate = screen.getByRole( 'button', { name: 'Annotate' } );
		expect( annotate ).toBeVisible();
		if ( ! annotatePreview ) {
			expect( annotate ).toBeDisabled();
			expect( annotate ).toHaveAttribute(
				'aria-description',
				'Site annotation is not available in the browser yet'
			);
		}
	}
);

it( 'keeps the address focused when its container narrows', async () => {
	const { resize } = await renderHeader( 'address-focus', createFakeConnector(), 1000 );
	const input = screen.getByRole( 'textbox', { name: 'Address' } );
	act( () => input.focus() );
	await resize( 390 );
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
	expect( input ).toHaveFocus();
} );

it( 'keeps browser navigation focused when the preview narrows', async () => {
	const { resize } = await renderHeader( 'navigation-focus', createFakeConnector(), 1000 );
	screen.getByRole( 'button', { name: 'Reload' } ).focus();
	await resize( 360, 1000 );
	expect( screen.getByRole( 'button', { name: 'Reload' } ) ).toHaveFocus();
	await resize( 1000 );
	expect(
		screen.queryByRole( 'button', { name: 'More preview actions' } )
	).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Reload' } ) ).toHaveFocus();
} );

it( 'waits for a measurable container before compacting browser controls', async () => {
	const { resize } = await renderHeader( 'unmeasured-header', createFakeConnector(), 0 );
	expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeVisible();
	await resize( 390 );
	expect( screen.queryByRole( 'button', { name: 'Annotate' } ) ).not.toBeInTheDocument();
	await resize( 0 );
	expect( screen.queryByRole( 'button', { name: 'Annotate' } ) ).not.toBeInTheDocument();
	await resize( 600 );
	expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeVisible();
} );
