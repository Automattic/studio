import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { markPreviewReady } from '@/data/preview-ready';
import { applySyncActivity } from '@/data/sync-activity';
import { SessionUIProvider } from '@/data/use-session-ui';
import {
	changeAnnotation,
	getSiteAnnotations,
	pickAnnotation,
	removeAnnotations,
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
	width = 60,
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
		<SiteHeaderActionsProvider host="preview">
			<SessionUIProvider>
				<SessionHeader
					site={ site }
					start={ <HeaderSidebarToggle /> }
					effectiveEnvironment="local"
				/>
				<SitePreview site={ site } path="/" reloadNonce={ 0 } />
				<SiteHeaderActions site={ site } onSendAnnotations={ onSendAnnotations } />
			</SessionUIProvider>
		</SiteHeaderActionsProvider>,
		{ connector }
	);
	await screen.findByRole( 'complementary', { name: 'Site preview' } );
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
	const { user } = await renderHeader( 'annotate-site', createFakeConnector(), 340 );
	await act( async () => {
		document
			.querySelector< HTMLElement >( '[data-preview-browser-controls]' )!
			.style.setProperty( '--preview-header-content-width', '400px' );
	} );
	const webview = readyGuest();
	const more = screen.getByRole( 'button', { name: 'More preview actions' } );
	const share = screen.getByRole( 'button', { name: 'Share' } );
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
	expect( share ).toHaveAttribute(
		'aria-description',
		expect.stringContaining( 'Creating preview' )
	);
	act( () => {
		applySyncActivity( 'annotate-site', { kind: 'success', direction: 'preview' } );
		markPreviewReady( 'annotate-site' );
	} );
	expect( share ).toHaveAttribute( 'aria-description', 'Preview ready' );
	expect( share ).toHaveTextContent( '' );
	await user.click( share );
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

it( 'hides annotation actions on Escape and restores the notes when annotation mode reopens', async () => {
	const siteId = 'header-send-site';
	const onSend = vi.fn();
	const { user } = await renderHeader( siteId, createFakeConnector(), 1000, true, onSend );
	readyGuest();
	const annotate = screen.getByRole( 'button', { name: 'Annotate' } );
	await waitFor( () => expect( annotate ).toBeEnabled() );
	expect( headerButtons( /^Send/ ) ).toHaveLength( 0 );
	await user.click( annotate );
	expect( headerButtons( /^Send/ ) ).toHaveLength( 0 );
	expect( screen.getByRole( 'toolbar', { name: 'Annotations' } ) ).toBeVisible();

	let noteId = '';
	act( () => {
		noteId = pickAnnotation( siteId, { selector: 'h1', tag: 'h1', path: '/' } )!;
		changeAnnotation( siteId, noteId, { comment: 'Make this heading smaller' } );
	} );
	expect( headerButtons( /^Send/ ) ).toHaveLength( 0 );
	act( () => stageAnnotations( siteId, [ noteId ] ) );
	expect( headerButtons( 'Send 1 annotation' )[ 0 ] ).toBeEnabled();
	await user.keyboard( '{Escape}' );
	expect( annotate ).toHaveAttribute( 'aria-pressed', 'false' );
	expect( headerButtons( /^Send/ ) ).toHaveLength( 0 );
	expect( headerButtons( 'Discard annotations' ) ).toHaveLength( 0 );
	expect( screen.queryByRole( 'toolbar', { name: 'Annotations' } ) ).not.toBeInTheDocument();
	expect( getSiteAnnotations( siteId ).notes[ 0 ].comment ).toBe( 'Make this heading smaller' );
	await user.click( annotate );
	expect( annotate ).toHaveAttribute( 'aria-pressed', 'true' );
	expect( headerButtons( 'Send 1 annotation' )[ 0 ] ).toBeEnabled();
	expect( headerButtons( 'Discard annotations' )[ 0 ] ).toBeEnabled();
	act( () => changeAnnotation( siteId, noteId, { comment: '' } ) );
	expect( headerButtons( /^Send/ ) ).toHaveLength( 0 );
	act( () => changeAnnotation( siteId, noteId, { comment: 'Make this heading smaller' } ) );
	const send = headerButtons( 'Send 1 annotation' )[ 0 ];
	expect( send ).toBeEnabled();
	await user.click( send );
	expect( onSend ).toHaveBeenCalledExactlyOnceWith( siteId );
	expect( getSiteAnnotations( siteId ).active ).toBe( false );
	expect( headerButtons( /^Send/ ) ).toHaveLength( 0 );
	act( () => removeAnnotations( siteId, [ noteId ] ) );
	expect( headerButtons( /^Send/ ) ).toHaveLength( 0 );
} );

it.each( [ true, false ] )(
	'restores annotation actions before discarding notes (initially active: %s)',
	async ( active ) => {
		const siteId = `header-cancel-${ active }`;
		const onSend = vi.fn();
		const { user } = await renderHeader( siteId, createFakeConnector(), 1000, true, onSend );
		readyGuest();
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeEnabled()
		);
		expect( headerButtons( 'Discard annotations' ) ).toHaveLength( 0 );
		act( () => {
			setAnnotating( siteId, true );
			const id = pickAnnotation( siteId, { selector: 'h1', tag: 'h1', path: '/' } )!;
			changeAnnotation( siteId, id, { comment: 'Keep this note until confirmed' } );
			stageAnnotations( siteId, [ id ] );
			setAnnotating( siteId, active );
		} );
		if ( ! active ) {
			expect( headerButtons( 'Discard annotations' ) ).toHaveLength( 0 );
			await user.click( screen.getByRole( 'button', { name: 'Annotate' } ) );
		}
		const cancel = headerButtons( 'Discard annotations' )[ 0 ];
		expect( cancel ).toBeEnabled();
		expect( headerButtons( 'Send 1 annotation' )[ 0 ] ).toBeEnabled();
		await user.click( cancel );
		let dialog = await screen.findByRole( 'alertdialog', {
			name: 'Discard all pending annotations?',
		} );
		await user.click( within( dialog ).getByRole( 'button', { name: 'Cancel' } ) );
		expect( getSiteAnnotations( siteId ).notes[ 0 ].comment ).toBe(
			'Keep this note until confirmed'
		);
		await user.click( cancel );
		dialog = await screen.findByRole( 'alertdialog', { name: 'Discard all pending annotations?' } );
		await user.click( within( dialog ).getByRole( 'button', { name: 'Discard' } ) );
		expect( getSiteAnnotations( siteId ).notes ).toHaveLength( 0 );
		expect( getSiteAnnotations( siteId ).active ).toBe( false );
		expect( headerButtons( 'Discard annotations' ) ).toHaveLength( 0 );
		expect( headerButtons( /^Send/ ) ).toHaveLength( 0 );
		expect( onSend ).not.toHaveBeenCalled();
	}
);

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

		await user.click( screen.getByRole( 'menuitem', { name: new RegExp( `^${ name }` ) } ) );
		await waitFor( effect );
	}
} );

it( 'keeps responsive mode on the right as the browser row compacts', async () => {
	const { user, resize } = await renderHeader( 'responsive-overflow', createFakeConnector(), 1000 );
	const toggle = screen.getByRole( 'button', { name: 'Responsive mode' } );
	const browser = screen.getByRole( 'toolbar', { name: 'Preview browser controls' } );
	expect( browser ).toContainElement( toggle );
	expect(
		screen.getByRole( 'textbox', { name: 'Address' } ).closest( 'form' )
	).not.toContainElement( toggle );
	await user.click( toggle );
	expect( toggle ).toHaveAttribute( 'aria-pressed', 'true' );
	expect( screen.getByRole( 'toolbar', { name: 'Responsive preview' } ) ).toBeInTheDocument();
	await resize( 320 );
	expect( screen.getByRole( 'button', { name: 'Responsive mode' } ) ).toBe( toggle );
	expect( toggle ).toHaveFocus();
	expect(
		screen.queryByRole( 'button', { name: 'More preview actions' } )
	).not.toBeInTheDocument();
	await user.click( toggle );
	expect( toggle ).toHaveAttribute( 'aria-pressed', 'false' );
	expect( screen.queryByRole( 'toolbar', { name: 'Responsive preview' } ) ).not.toBeInTheDocument();
	await resize( 1000 );
	expect( screen.getByRole( 'button', { name: 'Responsive mode' } ) ).toBe( toggle );
} );

it( 'keeps Annotate in its fixed header group at mobile widths', async () => {
	const { resize } = await renderHeader( 'mobile-annotate', createFakeConnector(), 600 );
	expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeVisible();
	await resize( 390 );
	expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeVisible();
	await resize( 600 );
	expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeVisible();
} );

it( 'keeps site actions in the main header without mobile browser overflow', async () => {
	const { resize } = await renderHeader( 'mobile-run', createFakeConnector(), 1000 );
	const browser = screen.getByRole( 'toolbar', { name: 'Preview browser controls' } );
	const mainHeader = document.querySelector( '[data-site-header]' )!;
	const annotate = screen.getByRole( 'button', { name: 'Annotate' } );
	expect( screen.queryByRole( 'button', { name: 'Stop site' } ) ).not.toBeInTheDocument();
	const share = screen.getByRole( 'button', { name: 'Share' } );
	const publish = screen.getByRole( 'button', { name: 'Publish…' } );
	expect( browser ).toContainElement( screen.getByRole( 'textbox', { name: 'Address' } ) );
	expect( mainHeader ).not.toContainElement( browser );
	for ( const action of [ annotate, share, publish ] )
		expect( browser ).not.toContainElement( action );
	await resize( 540 );
	expect(
		screen.queryByRole( 'button', { name: 'More preview actions' } )
	).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'Stop site' } ) ).not.toBeInTheDocument();
	for ( const name of [ 'Back', 'Forward', 'Reload preview', 'Responsive mode' ] )
		expect( within( browser ).getByRole( 'button', { name } ) ).toBeVisible();
	await resize( 1000 );
	expect(
		screen.queryByRole( 'button', { name: 'More preview actions' } )
	).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBe( publish );
} );

it( 'hides URL navigation entirely on mobile', async () => {
	const { resize } = await renderHeader( 'mobile-address', createFakeConnector(), 600 );
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
	await resize( 540 );
	expect( screen.queryByRole( 'textbox', { name: 'Address' } ) ).not.toBeInTheDocument();
	await resize( 600 );
	expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
} );

it( 'starts a stopped site with annotation mode selected', async () => {
	const connector = createFakeConnector();
	const { user } = await renderHeader( 'annotate-stopped', connector, 1000, false );
	const annotate = screen.getByRole( 'button', { name: 'Annotate' } );
	expect( annotate ).toBeEnabled();
	await user.click( annotate );
	expect( connector.startSite ).toHaveBeenCalledWith( 'annotate-stopped' );
	expect( getSiteAnnotations( 'annotate-stopped' ).active ).toBe( true );
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

it( 'moves focus to responsive mode when a narrow window hides the address', async () => {
	const { resize } = await renderHeader( 'address-focus', createFakeConnector(), 1000 );
	const input = screen.getByRole( 'textbox', { name: 'Address' } );
	act( () => input.focus() );
	await resize( 390 );
	expect( screen.queryByRole( 'textbox', { name: 'Address' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Responsive mode' } ) ).toHaveFocus();
} );

it( 'keeps browser focus reachable as navigation folds and unfolds', async () => {
	const { resize } = await renderHeader( 'navigation-focus', createFakeConnector(), 1000 );
	screen.getByRole( 'button', { name: 'Reload preview' } ).focus();
	await resize( 60, 1000 );
	expect( screen.getByRole( 'button', { name: 'More preview actions' } ) ).toHaveFocus();
	await resize( 1000 );
	expect(
		screen.queryByRole( 'button', { name: 'More preview actions' } )
	).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Responsive mode' } ) ).toHaveFocus();
} );
