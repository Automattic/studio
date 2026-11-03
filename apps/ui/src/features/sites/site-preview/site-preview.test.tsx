import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/agent/protocol/chat-artifacts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useSyncExternalStore, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateResponsivePreview } from '@/data/responsive-preview';
import { SessionUIProvider } from '@/data/use-session-ui';
import {
	changeAnnotation,
	pickAnnotation,
	removeAnnotations,
	setAnnotating,
	stageAnnotations,
} from '@/features/annotations';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SiteHeaderActionsProvider } from '../site-header-actions';
import { SitePreview } from './index';

type Runtime = 'browser' | 'desktop';
type Props = ComponentProps< typeof SitePreview >;

const REAL_USER_AGENT = window.navigator.userAgent;
const SITE_URL = 'http://localhost:9010';

afterEach( () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	Object.defineProperty( window.navigator, 'userAgent', {
		value: REAL_USER_AGENT,
		configurable: true,
	} );
} );

function createPropsStore( initial: Props ) {
	let props = initial;
	const listeners = new Set< () => void >();
	return {
		get: () => props,
		subscribe: ( listener: () => void ) => {
			listeners.add( listener );
			return () => listeners.delete( listener );
		},
		update: ( patch: Partial< Props > ) =>
			act( () => {
				props = { ...props, ...patch };
				listeners.forEach( ( listener ) => listener() );
			} ),
	};
}

function Harness( { store }: { store: ReturnType< typeof createPropsStore > } ) {
	const props = useSyncExternalStore( store.subscribe, store.get );
	return (
		<SiteHeaderActionsProvider host="preview">
			<SessionUIProvider>
				<SitePreview { ...props } />
			</SessionUIProvider>
		</SiteHeaderActionsProvider>
	);
}

async function renderPreview(
	runtime: Runtime,
	props: Partial< Props > = {},
	connector = createFakeConnector()
) {
	Object.defineProperty( window.navigator, 'userAgent', {
		value: runtime === 'desktop' ? `${ REAL_USER_AGENT } Electron/38.0.0` : REAL_USER_AGENT,
		configurable: true,
	} );
	vi.stubGlobal(
		'fetch',
		vi.fn( async () => new Response() )
	);
	vi.stubGlobal( 'ipcApi', { clearWebviewCache: vi.fn( async () => {} ) } );
	const site = makeSite( { id: 'one', port: 9010, running: true } );
	const store = createPropsStore( { site, path: '/', reloadNonce: 0, ...props } );
	const view = renderWithProviders( <Harness store={ store } />, { connector } );
	await screen.findByRole( 'complementary', { name: 'Site preview' } );
	return { ...view, update: store.update };
}

type Guest = HTMLElement & {
	reload: ReturnType< typeof vi.fn >;
	loadURL: ReturnType< typeof vi.fn >;
};

function page() {
	return document.querySelector< HTMLElement >( 'iframe, webview' );
}

function guest( extra: Record< string, unknown > = {} ) {
	const element = document.querySelector( 'webview' ) as Guest;
	Object.assign( element, {
		loadURL: vi.fn( async () => {} ),
		reload: vi.fn(),
		executeJavaScript: vi.fn( async () => undefined ),
		getWebContentsId: () => 42,
		...extra,
	} );
	return element;
}

function finishLoading( runtime: Runtime ) {
	const element = page()!;
	if ( runtime === 'desktop' ) {
		fireEvent( element, new Event( 'did-finish-load' ) );
		fireEvent( element, new Event( 'did-stop-loading' ) );
	} else {
		fireEvent.load( element );
	}
}

const clearWebviewCache = () =>
	( window as unknown as { ipcApi: { clearWebviewCache: ReturnType< typeof vi.fn > } } ).ipcApi
		.clearWebviewCache;
const isPageHidden = () => !! page()!.closest( '[data-loading]' );
const logo = () => document.querySelector( 'span[aria-hidden="true"][data-active]' );
const site = ( overrides: Partial< Props[ 'site' ] > = {} ) =>
	makeSite( { id: 'one', port: 9010, running: true, ...overrides } );
const address = () => screen.getByRole( 'textbox', { name: 'Address' } ) as HTMLInputElement;
const submit = ( value: string ) => {
	fireEvent.change( address(), { target: { value } } );
	fireEvent.submit( address().closest( 'form' )! );
};

describe( 'site preview', () => {
	it.each( [ 'browser', 'desktop' ] as const )(
		'captures the %s thumbnail after the preview panel opens',
		async ( runtime ) => {
			const connector = createFakeConnector();
			await renderPreview( runtime, {}, connector );
			vi.useFakeTimers();
			const viewport = page()!.closest< HTMLElement >( 'div[class*="previewViewport"]' )!;
			let width = 0;
			Object.defineProperties( viewport, {
				clientWidth: { get: () => width },
				clientHeight: { get: () => 800 },
			} );
			if ( runtime === 'desktop' ) {
				guest();
				fireEvent( page()!, new Event( 'dom-ready' ) );
			}
			finishLoading( runtime );
			await act( async () => {} );
			expect( connector.captureSitePreview ).not.toHaveBeenCalled();
			width = 600;
			Object.defineProperties( page()!, {
				clientWidth: { value: 400 },
				clientHeight: { value: 800 },
			} );
			await act( async () => {
				await vi.advanceTimersByTimeAsync( 1000 );
			} );
			expect( connector.captureSitePreview ).toHaveBeenCalledExactlyOnceWith(
				'one',
				expect.objectContaining( { width: 400, height: 800 } )
			);
		}
	);

	it.each( [ 'browser', 'desktop' ] as const )(
		'keeps the %s page visible during loading, navigation, and reloads',
		async ( runtime ) => {
			const { update } = await renderPreview( runtime );
			if ( runtime === 'desktop' ) {
				guest();
				fireEvent( page()!, new Event( 'did-start-loading' ) );
			}
			expect( isPageHidden() ).toBe( false );
			if ( runtime === 'desktop' ) fireEvent( page()!, new Event( 'dom-ready' ) );
			finishLoading( runtime );
			await waitFor( () => expect( isPageHidden() ).toBe( false ) );
			update( { path: '/about' } );
			if ( runtime === 'desktop' ) {
				fireEvent( page()!, new Event( 'did-start-loading' ) );
			}
			expect( isPageHidden() ).toBe( false );
			finishLoading( runtime );
			update( { reloadNonce: 1 } );
			if ( runtime === 'desktop' ) {
				await waitFor( () => expect( ( page() as Guest ).reload ).toHaveBeenCalled() );
				fireEvent( page()!, new Event( 'did-start-loading' ) );
			}
			expect( isPageHidden() ).toBe( false );
			finishLoading( runtime );
			await waitFor( () => expect( isPageHidden() ).toBe( false ) );
		}
	);

	it( 'keeps desktop reload available when chat changes the navigation callbacks', async () => {
		const { update } = await renderPreview( 'desktop', { onPathChange: vi.fn() } );
		const webview = guest();
		fireEvent( webview, new Event( 'dom-ready' ) );
		finishLoading( 'desktop' );
		const onPathChange = vi.fn();
		update( { reloadNonce: 1, onPathChange } );
		await waitFor( () => expect( webview.reload ).toHaveBeenCalledOnce() );
		fireEvent(
			webview,
			Object.assign( new Event( 'did-navigate' ), { url: `${ SITE_URL }/page` } )
		);
		expect( onPathChange ).toHaveBeenCalledWith( '/page' );
		expect( document.querySelector( 'webview' ) ).toBe( webview );
	} );

	it.each( [ 'browser', 'desktop' ] as const )(
		'keeps startup loading mounted on %s until the server and page are ready',
		async ( runtime ) => {
			const { update } = await renderPreview( runtime, {
				site: makeSite( {
					id: 'one',
					port: 9010,
					running: false,
					operation: { pid: 1, kind: 'start' },
				} ),
			} );
			const loadingLogo = logo();
			const particles = document.querySelector( 'canvas' );
			expect( particles ).toBeInTheDocument();
			expect( logo() ).toBeInTheDocument();
			expect( page() ).toBeNull();
			expect( screen.getByText( 'Loading site preview' ) ).toBeInTheDocument();
			update( { site: makeSite( { id: 'one', port: 9010, running: true } ) } );
			expect( isPageHidden() ).toBe( true );
			expect( document.querySelector( 'canvas' ) ).toBe( particles );
			expect( logo() ).toBe( loadingLogo );
			expect( logo() ).toBeInTheDocument();
			expect( screen.getByText( 'Loading site preview' ) ).toBeInTheDocument();
			if ( runtime === 'desktop' ) {
				guest();
				fireEvent( page()!, new Event( 'dom-ready' ) );
				expect( screen.getByText( 'Loading site preview' ) ).toBeInTheDocument();
			}
			finishLoading( runtime );
			await waitFor( () =>
				expect( screen.queryByText( 'Loading site preview' ) ).not.toBeInTheDocument()
			);
			await waitFor( () => expect( logo() ).toBeNull() );
			expect( isPageHidden() ).toBe( false );
			expect( document.querySelectorAll( 'canvas' ) ).toHaveLength( 0 );
		}
	);

	it( 'reports the guest URL and native history after navigation', async () => {
		const onPathChange = vi.fn();
		const { user } = await renderPreview( 'desktop', { onPathChange } );
		expect( fireEvent.contextMenu( screen.getByRole( 'button', { name: 'Back' } ) ) ).toBe( false );
		expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument();
		const goBack = vi.fn();
		const webview = guest( {
			getURL: () => `${ SITE_URL }/about/`,
			canGoBack: () => true,
			canGoForward: () => false,
			goBack,
		} );
		fireEvent( webview, new Event( 'dom-ready' ) );
		fireEvent(
			webview,
			Object.assign( new Event( 'did-navigate' ), { url: `${ SITE_URL }/about/` } )
		);
		expect( onPathChange ).toHaveBeenLastCalledWith( '/about/' );
		expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Forward' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		await user.click( screen.getByRole( 'button', { name: 'Back' } ) );
		expect( goBack ).toHaveBeenCalledOnce();
	} );

	it( 'shows main-frame failures and provides retry', async () => {
		const { user } = await renderPreview( 'desktop' );
		const webview = guest();
		fireEvent( webview, new Event( 'dom-ready' ) );
		fireEvent(
			webview,
			Object.assign( new Event( 'did-fail-load' ), { errorCode: -102, isMainFrame: true } )
		);
		expect( screen.getByText( 'Preview could not load' ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Try again' } ) );
		await waitFor( () => expect( webview.reload ).toHaveBeenCalledOnce() );
	} );

	it( 'asks the site whether a framed page is there, and retries when it is not', async () => {
		const { user } = await renderPreview( 'browser' );
		vi.mocked( fetch ).mockRejectedValueOnce( new TypeError( 'Failed to fetch' ) );
		finishLoading( 'browser' );
		await user.click( await screen.findByRole( 'button', { name: 'Try again' } ) );
		finishLoading( 'browser' );
		await waitFor( () =>
			expect( screen.queryByText( 'Preview could not load' ) ).not.toBeInTheDocument()
		);
		expect( fetch ).toHaveBeenCalledWith( `${ SITE_URL }/`, expect.anything() );
	} );

	it( 'ignores aborted navigations and subframe errors', async () => {
		await renderPreview( 'desktop' );
		const webview = guest();
		fireEvent(
			webview,
			Object.assign( new Event( 'did-fail-load' ), { errorCode: -3, isMainFrame: true } )
		);
		fireEvent(
			webview,
			Object.assign( new Event( 'did-fail-load' ), { errorCode: -102, isMainFrame: false } )
		);
		expect( screen.queryByText( 'Preview could not load' ) ).not.toBeInTheDocument();
	} );

	it( 'queues early reloads until the Electron guest is ready', async () => {
		const { update } = await renderPreview( 'desktop' );
		const webview = guest();
		update( { reloadNonce: 1 } );
		await act( async () => {} );
		expect( webview.reload ).not.toHaveBeenCalled();
		fireEvent( webview, new Event( 'dom-ready' ) );
		await waitFor( () => expect( webview.reload ).toHaveBeenCalledOnce() );
	} );
	it( 'never exposes the previous site URL, history actions, or late webview events', async () => {
		const first = makeSite( { id: 'one', port: 8001, running: true } );
		const second = makeSite( { id: 'two', port: 8002, running: true } );
		const { update } = await renderPreview( 'desktop', {
			site: first,
			onPathChange: ( path ) => update( { path } ),
		} );
		const back = () => screen.getByRole( 'button', { name: 'Back' } );
		const previousWebview = guest( {
			executeJavaScript: vi.fn( async () => '' ),
			canGoBack: () => true,
			canGoForward: () => false,
		} );
		fireEvent( previousWebview, new Event( 'dom-ready' ) );
		fireEvent(
			previousWebview,
			Object.assign( new Event( 'did-navigate' ), { url: 'http://localhost:8001/page' } )
		);
		expect( address() ).toHaveValue( 'http://localhost:8001/page' );
		expect( back() ).not.toHaveAttribute( 'aria-disabled', 'true' );
		update( { site: second, path: '/' } );
		expect( address() ).toHaveValue( 'http://localhost:8002' );
		expect( back() ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent(
			previousWebview,
			Object.assign( new Event( 'did-navigate' ), { url: 'http://localhost:8001/late' } )
		);
		expect( address() ).toHaveValue( 'http://localhost:8002' );
		update( { site: first, path: '/' } );
		expect( address() ).toHaveValue( 'http://localhost:8001/page' );
		expect( back() ).toHaveAttribute( 'aria-disabled', 'true' );
	} );
} );

describe( 'site preview controls', () => {
	it( 'keeps the reloaded frame when Back or Forward follows a reload', async () => {
		const { user } = await renderPreview( 'browser' );
		await user.click( screen.getByRole( 'button', { name: 'Reload preview' } ) );
		const reloaded = page();
		fireEvent.keyDown( document.body, { key: '[', ctrlKey: true } );
		fireEvent.keyDown( document.body, { key: ']', ctrlKey: true } );
		expect( page() ).toBe( reloaded );
	} );

	it( 'reloads on the primary-modifier+R shortcut from the composer, but not from a dialog', async () => {
		await renderPreview( 'browser' );
		const composer = document.body.appendChild( document.createElement( 'textarea' ) );
		composer.focus();
		const initial = page();
		fireEvent.keyDown( composer, { key: 'r', ctrlKey: true } );
		const reloaded = page();
		expect( reloaded ).not.toBe( initial );
		fireEvent.keyDown( composer, { key: 'r', ctrlKey: true, shiftKey: true } );
		const aliasReloaded = page();
		expect( aliasReloaded ).not.toBe( reloaded );
		fireEvent.keyDown( composer, { key: 'r', ctrlKey: true, altKey: true } );
		const dialog = document.body.appendChild( document.createElement( 'div' ) );
		dialog.dataset.slot = 'dialog-content';
		fireEvent.keyDown( dialog, { key: 'r', ctrlKey: true } );
		expect( page() ).toBe( aliasReloaded );
		composer.remove();
		dialog.remove();
	} );

	it( 'shows loaded page titles and URLs as recent destinations', async () => {
		const { update } = await renderPreview( 'desktop', { path: '/about/' } );
		const webview = guest();
		fireEvent( webview, new Event( 'dom-ready' ) );
		fireEvent(
			webview,
			Object.assign( new Event( 'page-title-updated' ), { title: 'About the project' } )
		);
		update( { path: '/contact/' } );
		fireEvent(
			webview,
			Object.assign( new Event( 'page-title-updated' ), { title: 'Contact us' } )
		);
		fireEvent.click( screen.getByRole( 'textbox', { name: 'Address' } ) );
		expect(
			await screen.findByRole( 'option', { name: /About the project.*localhost:9010\/about\// } )
		).toBeVisible();
		expect(
			screen.getByRole( 'option', { name: /Contact us.*localhost:9010\/contact\// } )
		).toBeVisible();
		expect( screen.queryByRole( 'option', { name: 'WordPress Admin' } ) ).not.toBeInTheDocument();
	} );

	it( 'opens the front end externally logged out and WP Admin with auto-login', async () => {
		const connector = createFakeConnector();
		const { update, user } = await renderPreview(
			'browser',
			{ path: '/sample-page/', onPathChange: vi.fn() },
			connector
		);
		const open = () =>
			user.click( screen.getByRole( 'button', { name: 'Open this page in your browser' } ) );
		await open();
		expect( connector.openSiteUrl ).toHaveBeenLastCalledWith( 'one', '/sample-page/', {
			autoLogin: false,
		} );
		update( { path: '/wp-admin/' } );
		await open();
		expect( connector.openSiteUrl ).toHaveBeenLastCalledWith( 'one', '/wp-admin/', {
			autoLogin: true,
		} );
	} );

	it.each( [ undefined, 'https://example.wordpress.com' ] )(
		'keeps responsive settings on site surfaces and suspends the toolbar for tools (live: %s)',
		async ( liveUrl ) => {
			const siteId = `responsive-surfaces-${ liveUrl ?? 'local' }`;
			const { update, user } = await renderPreview( 'browser', {
				site: site( { id: siteId } ),
				liveUrl,
			} );
			const responsiveToggle = () => screen.getByRole( 'button', { name: 'Responsive mode' } );
			await user.click( responsiveToggle() );
			act( () => updateResponsivePreview( siteId, { width: 512 } ) );
			update( { path: '/phpmyadmin/index.php' } );
			expect( responsiveToggle() ).toHaveAttribute( 'aria-disabled', 'true' );
			expect(
				screen.queryByRole( 'toolbar', { name: 'Responsive preview' } )
			).not.toBeInTheDocument();
			update( { path: DESIGN_SYSTEM_PREVIEW_PATH } );
			expect( responsiveToggle() ).toHaveAttribute( 'aria-disabled', 'true' );
			expect(
				screen.queryByRole( 'toolbar', { name: 'Responsive preview' } )
			).not.toBeInTheDocument();
			update( { path: '/wp-admin/' } );
			expect( responsiveToggle() ).not.toHaveAttribute( 'aria-disabled', 'true' );
			expect( responsiveToggle() ).toHaveAttribute( 'aria-pressed', 'true' );
			expect( screen.getByRole( 'textbox', { name: 'Width' } ) ).toHaveValue( '512' );
		}
	);

	it.each( [ undefined, 'https://example.wordpress.com' ] )(
		'leaves WP Admin alone when the host reloads (live: %s)',
		async ( liveUrl ) => {
			const { update } = await renderPreview( 'desktop', {
				liveUrl,
				path: '/wp-admin/post.php?post=1&action=edit',
			} );
			const webview = guest();
			fireEvent( webview, new Event( 'dom-ready' ) );
			update( { reloadNonce: 1 } );
			await act( async () => {} );
			expect( webview.reload ).not.toHaveBeenCalled();
			expect( clearWebviewCache() ).not.toHaveBeenCalled();
		}
	);

	it( 'navigates without dropping the cache when the path changes with the nonce', async () => {
		const { update } = await renderPreview( 'desktop' );
		const webview = guest();
		fireEvent( webview, new Event( 'dom-ready' ) );
		update( { path: '/about', reloadNonce: 1 } );
		await waitFor( () => expect( webview.loadURL ).toHaveBeenCalledWith( `${ SITE_URL }/about` ) );
		expect( webview.reload ).not.toHaveBeenCalled();
		expect( clearWebviewCache() ).not.toHaveBeenCalled();
	} );

	it( 'drops the cache and reloads in place after the preview navigated itself', async () => {
		const { update } = await renderPreview( 'desktop' );
		const webview = guest();
		fireEvent( webview, new Event( 'dom-ready' ) );
		fireEvent(
			webview,
			Object.assign( new Event( 'did-navigate' ), { url: `${ SITE_URL }/about` } )
		);
		update( { path: '/about' } );
		expect( webview.loadURL ).not.toHaveBeenCalled();
		update( { path: '/about', reloadNonce: 1 } );
		await waitFor( () => expect( webview.reload ).toHaveBeenCalledOnce() );
		expect( clearWebviewCache() ).toHaveBeenCalledWith( 42 );
		expect( webview.loadURL ).not.toHaveBeenCalled();
	} );
} );

describe( 'site email', () => {
	it( 'switches to the rendered email surface when the path changes', async () => {
		const { update } = await renderPreview( 'browser' );
		update( { path: 'studio:email' } );
		expect( await screen.findByText( 'No email yet' ) ).toBeVisible();
		expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue( 'Email' );
	} );

	it( 'opens links to the site in the preview and other links in the browser', async () => {
		const connector = createFakeConnector( {
			emails: {
				one: [
					{
						id: '20261028-090000-000001-aaaaaa.eml',
						subject: 'Password Reset',
						from: null,
						to: [ { name: '', address: 'admin@example.com' } ],
						cc: [],
						replyTo: [],
						date: '2026-10-28T09:00:00.000Z',
						html: null,
						text: `${ SITE_URL }/wp-login.php?action=rp&key=abc\nhttps://wordpress.org/support/\n`,
						attachments: [],
						source: '',
					},
				],
			},
		} );
		const onPathChange = vi.fn();
		await renderPreview( 'browser', { path: 'studio:email', onPathChange }, connector );
		expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue( 'Email' );
		expect( page() ).toBeNull();

		fireEvent.click( await screen.findByRole( 'option', { name: /Password Reset/ } ) );
		fireEvent.click( await screen.findByRole( 'link', { name: /wp-login\.php/ } ) );
		expect( onPathChange ).toHaveBeenLastCalledWith( '/wp-login.php?action=rp&key=abc' );

		fireEvent.click( screen.getByRole( 'link', { name: 'https://wordpress.org/support/' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith( 'https://wordpress.org/support/' );
	} );

	it( 'keeps the address editable and responsive mode disabled for email', async () => {
		const onPathChange = vi.fn();
		await renderPreview( 'browser', { path: 'studio:email', onPathChange } );
		const input = screen.getByRole( 'textbox', { name: 'Address' } );
		expect( input ).toHaveValue( 'Email' );
		expect( screen.getByRole( 'button', { name: 'Responsive mode' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		fireEvent.change( input, { target: { value: '/' } } );
		fireEvent.submit( input.closest( 'form' )! );
		expect( onPathChange ).toHaveBeenLastCalledWith( '/' );
	} );
} );

describe( 'preview address bar', () => {
	it.each( [ 'browser', 'desktop' ] as const )(
		'hides the browser bar until startup finishes in %s',
		async ( runtime ) => {
			const { update } = await renderPreview( runtime, {
				site: site( { running: false, operation: { pid: 1, kind: 'start' } } ),
			} );
			expect(
				screen.queryByRole( 'toolbar', { name: 'Preview browser controls' } )
			).not.toBeInTheDocument();
			update( { site: site() } );
			expect(
				screen.queryByRole( 'toolbar', { name: 'Preview browser controls' } )
			).not.toBeInTheDocument();
			if ( runtime === 'desktop' ) guest();
			finishLoading( runtime );
			await waitFor( () => expect( address() ).toBeEnabled() );
		}
	);

	it( 'hides the browser bar once stopped and restores its path on restart', async () => {
		const stopping = { pid: 1, kind: 'stop' } as const;
		const { update } = await renderPreview( 'browser', {
			path: '/about/',
			site: site( { operation: stopping } ),
		} );
		expect( screen.getByRole( 'toolbar', { name: 'Preview browser controls' } ) ).toBeVisible();
		update( { site: site( { running: false, operation: stopping } ) } );
		expect(
			screen.queryByRole( 'toolbar', { name: 'Preview browser controls' } )
		).not.toBeInTheDocument();
		update( { site: site( { running: false } ) } );
		expect( screen.queryByText( 'Stopping site…' ) ).not.toBeInTheDocument();
		update( { site: site() } );
		expect( address() ).toHaveValue( `${ SITE_URL }/about/` );
	} );

	it( 'toggles responsive mode from the preview toolbar', async () => {
		const { user } = await renderPreview( 'browser', {
			site: site( { id: 'address-responsive' } ),
		} );
		const toggle = screen.getByRole( 'button', { name: 'Responsive mode' } );
		expect( address().closest( 'form' ) ).not.toContainElement( toggle );
		expect( screen.getByRole( 'toolbar', { name: 'Preview browser controls' } ) ).toContainElement(
			toggle
		);
		await user.click( toggle );
		expect( toggle ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( address() ).not.toHaveFocus();
		expect( screen.queryByRole( 'dialog', { name: 'Recent pages' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'toolbar', { name: 'Responsive preview' } ) ).toBeInTheDocument();
		await user.click( toggle );
		expect( toggle ).toHaveAttribute( 'aria-pressed', 'false' );
		expect( address() ).not.toHaveFocus();
		expect(
			screen.queryByRole( 'toolbar', { name: 'Responsive preview' } )
		).not.toBeInTheDocument();
	} );

	it( 'keeps root addresses stable after loading and preserves page paths', async () => {
		const { update } = await renderPreview( 'browser', { path: '' } );
		const input = address();
		update( { path: '/' } );
		expect( input ).toHaveValue( SITE_URL );
		for ( const path of [ '/about/', '/?page=2', '/#section' ] ) {
			update( { path } );
			expect( input ).toHaveValue( SITE_URL + path );
		}
	} );

	it( 'opens database addresses in the desktop preview', async () => {
		const onPathChange = vi.fn();
		const connector = createFakeConnector();
		await renderPreview( 'desktop', { onPathChange }, connector );
		const path = '/phpmyadmin/index.php?route=/database/structure&db=wordpress';
		submit( path );
		expect( onPathChange ).toHaveBeenCalledWith( path );
		expect( connector.openSiteUrl ).not.toHaveBeenCalled();
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	} );

	it( 'shows project tools in the stopped preview and restores the editable address when started', async () => {
		const { update } = await renderPreview( 'browser', { path: '/about/' } );
		expect( address() ).toHaveValue( `${ SITE_URL }/about/` );
		update( { site: site( { running: false } ) } );
		expect(
			screen.queryByRole( 'toolbar', { name: 'Preview browser controls' } )
		).not.toBeInTheDocument();
		expect( screen.getByRole( 'group', { name: 'Project tools' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Start site' } ) ).not.toBeInTheDocument();
		update( { site: site( { running: false, operation: { pid: 1, kind: 'settings' } } ) } );
		expect(
			screen.queryByRole( 'toolbar', { name: 'Preview browser controls' } )
		).not.toBeInTheDocument();
		update( { site: site() } );
		expect( address() ).toHaveValue( `${ SITE_URL }/about/` );
		expect( address() ).toBeEnabled();
		expect( screen.getByRole( 'button', { name: 'Responsive mode' } ) ).toBeInTheDocument();
		update( { site: site( { operation: { pid: 1, kind: 'stop' } } ) } );
		expect( screen.getByRole( 'toolbar', { name: 'Preview browser controls' } ) ).toBeVisible();
	} );

	it.each( [ 'browser', 'desktop' ] as const )(
		'starts a stopped %s preview from its shared Browser tool and removes the launcher while loading',
		async ( runtime ) => {
			let finish!: () => void;
			const pending = new Promise< void >( ( resolve ) => {
				finish = resolve;
			} );
			const connector = createFakeConnector( {}, { startSite: () => pending } );
			await renderPreview(
				runtime,
				{ site: site( { running: false } ), onPathChange: vi.fn() },
				connector
			);
			expect( screen.getByRole( 'button', { name: 'Browser B' } ) ).toBeVisible();
			expect( screen.getByRole( 'button', { name: 'Admin A' } ) ).toBeVisible();
			expect( screen.getByRole( 'button', { name: 'Database D' } ) ).toBeVisible();
			expect( screen.getByRole( 'button', { name: 'Email E' } ) ).toBeVisible();
			fireEvent.click( screen.getByRole( 'button', { name: 'Browser B' } ) );
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'one' ) );
			expect( screen.queryByRole( 'group', { name: 'Project tools' } ) ).not.toBeInTheDocument();
			await act( async () => finish() );
		}
	);

	it( 'selects the whole address on first pointer focus without overriding later clicks', async () => {
		await renderPreview( 'browser', { path: '/about/' } );
		const input = address();
		fireEvent.focus( input );
		expect( input.selectionStart ).toBe( 0 );
		expect( input.selectionEnd ).toBe( input.value.length );
		input.focus();
		input.setSelectionRange( 7, 7 );
		fireEvent.pointerDown( input, { button: 0 } );
		expect( input.selectionStart ).toBe( 7 );
		expect( input.selectionEnd ).toBe( 7 );
	} );
} );

it.each( [ 'browser', 'desktop' ] as const )(
	'reopens the email and format for a batched annotation in %s',
	async ( runtime ) => {
		const email = {
			id: 'reset.eml',
			subject: 'Password Reset',
			from: { name: 'WordPress', address: 'wordpress@localhost' },
			to: [],
			cc: [],
			replyTo: [],
			date: '2026-11-03T09:00:00.000Z',
			html: '<p>Email heading</p>',
			text: 'Email heading',
			attachments: [],
			source: 'Email heading',
		};
		const ids: string[] = [];
		act( () => {
			setAnnotating( 'one', true );
			for ( const part of [ 'text', 'html' ] as const ) {
				const id = pickAnnotation( 'one', {
					email: { id: email.id, subject: email.subject, part, paragraph: 0 },
					...( part === 'html' ? { selector: 'p' } : {} ),
				} )!;
				ids.push( id );
				changeAnnotation( 'one', id, { comment: `Update the ${ part } heading` } );
				stageAnnotations( 'one', [ id ], true );
			}
			setAnnotating( 'one', false );
		} );
		try {
			const onPathChange = vi.fn();
			const { user, update } = await renderPreview(
				runtime,
				{ onPathChange, onSendAnnotations: vi.fn() },
				createFakeConnector( { emails: { one: [ email ] } } )
			);
			for ( const part of [ 'text', 'html' ] as const ) {
				await user.click( screen.getByRole( 'button', { name: 'Review annotations' } ) );
				await user.click(
					await screen.findByRole( 'button', {
						name: new RegExp( `Edit annotation [0-9]+: Update the ${ part } heading` ),
					} )
				);
				expect( onPathChange ).toHaveBeenLastCalledWith( 'studio:email' );
				update( { path: 'studio:email' } );
				await screen.findByRole( 'article', { name: 'Password Reset' } );
				expect(
					screen.getByRole( 'tab', { name: part === 'text' ? 'Text' : 'HTML' } )
				).toHaveAttribute( 'aria-selected', 'true' );
				if ( part === 'html' ) {
					const frame = screen.getByTitle< HTMLIFrameElement >( 'Email content' );
					frame.contentDocument!.body.innerHTML = email.html;
					fireEvent.load( frame );
				}
				expect( await screen.findByRole( 'textbox', { name: 'Leave a note' } ) ).toHaveValue(
					`Update the ${ part } heading`
				);
				update( { path: '/' } );
			}
		} finally {
			act( () => {
				removeAnnotations( 'one', ids );
				setAnnotating( 'one', false );
			} );
		}
	}
);
