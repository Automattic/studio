import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useSyncExternalStore, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionUIProvider } from '@/data/use-session-ui';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
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
		<SessionUIProvider>
			<SitePreview { ...props } />
		</SessionUIProvider>
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
const logo = () => document.querySelector( 'canvas ~ span[aria-hidden="true"]' );

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
			await act( async () => {
				await vi.advanceTimersByTimeAsync( 1000 );
			} );
			expect( connector.captureSitePreview ).toHaveBeenCalledExactlyOnceWith(
				'one',
				expect.objectContaining( { width: 600, height: 800 } )
			);
		}
	);

	it.each( [ 'browser', 'desktop' ] as const )(
		'reports %s readiness after the page loads',
		async ( runtime ) => {
			const { update } = await renderPreview( runtime, {
				site: makeSite( {
					id: 'one',
					port: 9010,
					running: true,
					operation: { pid: 1, kind: 'start' },
				} ),
			} );
			update( { site: makeSite( { id: 'one', port: 9010, running: true } ) } );
			expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Loading site preview' );
			if ( runtime === 'desktop' ) {
				guest();
				fireEvent( page()!, new Event( 'dom-ready' ) );
				expect( screen.getByRole( 'status' ) ).toBeInTheDocument();
			}
			finishLoading( runtime );
			await waitFor( () => expect( screen.queryByRole( 'status' ) ).not.toBeInTheDocument() );
		}
	);

	it.each( [ 'browser', 'desktop' ] as const )(
		'reveals the %s page only after loading and resets readiness on reload',
		async ( runtime ) => {
			const { update } = await renderPreview( runtime );
			if ( runtime === 'desktop' ) {
				guest();
				fireEvent( page()!, new Event( 'did-start-loading' ) );
			}
			expect( isPageHidden() ).toBe( true );
			if ( runtime === 'desktop' ) fireEvent( page()!, new Event( 'dom-ready' ) );
			finishLoading( runtime );
			await waitFor( () => expect( isPageHidden() ).toBe( false ) );
			update( { reloadNonce: 1 } );
			if ( runtime === 'desktop' ) {
				await waitFor( () => expect( ( page() as Guest ).reload ).toHaveBeenCalled() );
				fireEvent( page()!, new Event( 'did-start-loading' ) );
			}
			expect( isPageHidden() ).toBe( true );
			finishLoading( runtime );
			await waitFor( () => expect( isPageHidden() ).toBe( false ) );
		}
	);

	it( 'finishes loading and reloads the guest without replacing its browsing session', async () => {
		const { update } = await renderPreview( 'desktop' );
		const webview = guest();
		fireEvent( webview, new Event( 'dom-ready' ) );
		finishLoading( 'desktop' );
		expect( screen.queryByRole( 'status' ) ).not.toBeInTheDocument();
		update( { reloadNonce: 1 } );
		await waitFor( () => expect( webview.reload ).toHaveBeenCalledOnce() );
		expect( document.querySelector( 'webview' ) ).toBe( webview );
	} );

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
			const particles = document.querySelector( 'canvas' );
			expect( particles ).toBeInTheDocument();
			expect( logo() ).toBeInTheDocument();
			expect( page() ).toBeNull();
			expect( screen.getByText( 'Loading site preview' ) ).toBeInTheDocument();
			update( { site: makeSite( { id: 'one', port: 9010, running: true } ) } );
			expect( document.querySelector( 'canvas' ) ).toBe( particles );
			expect( logo() ).toBeInTheDocument();
			expect( screen.getByText( 'Loading site preview' ) ).toBeInTheDocument();
			if ( runtime === 'desktop' ) {
				guest();
				fireEvent( page()!, new Event( 'dom-ready' ) );
			}
			finishLoading( runtime );
			await waitFor( () =>
				expect( screen.queryByText( 'Loading site preview' ) ).not.toBeInTheDocument()
			);
			await waitFor( () => expect( logo() ).toBeNull() );
			expect( document.querySelectorAll( 'canvas' ) ).toHaveLength( 1 );
		}
	);

	it( 'reports the guest URL and native history after navigation', async () => {
		const onPathChange = vi.fn();
		const { user } = await renderPreview( 'desktop', { onPathChange } );
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

	it( 'switches realms from the address menu, recording only real switches', async () => {
		const connector = createFakeConnector();
		const onPathChange = vi.fn();
		const { update } = await renderPreview( 'browser', { onPathChange }, connector );
		const pick = async ( name: string ) => {
			fireEvent.click( screen.getByRole( 'textbox', { name: 'Address' } ) );
			fireEvent.click( await screen.findByRole( 'option', { name } ) );
		};
		await pick( 'WP Admin' );
		expect( onPathChange ).toHaveBeenLastCalledWith(
			`/studio-auto-login?redirect_to=${ encodeURIComponent( `${ SITE_URL }/wp-admin/` ) }`
		);
		expect( connector.trackEvent ).toHaveBeenCalledWith( 'studio_site_open_wp_admin', {
			browser: 'internal',
		} );
		await pick( 'Database' );
		expect( onPathChange ).toHaveBeenLastCalledWith(
			'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
		);

		update( { path: '/wp-admin/' } );
		onPathChange.mockClear();
		connector.trackEvent.mockClear();
		await pick( 'WP Admin' );
		expect( onPathChange ).not.toHaveBeenCalled();
		expect( connector.trackEvent ).not.toHaveBeenCalled();
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

	it.each( [
		[ 'the host supports it', true, true, true ],
		[ 'the host cannot annotate', false, true, false ],
		[ 'Studio Code is on', true, false, false ],
	] )( 'shows Annotate only when %s', async ( _, annotatePreview, agentic, shown ) => {
		const connector = createFakeConnector(
			{ preferences: { agenticFeaturesEnabled: agentic } },
			{ capabilities: { nativeFolderPicker: true, annotatePreview, studioLogs: true } }
		);
		await renderPreview( 'browser', {}, connector );
		expect( screen.getByRole( 'button', { name: 'Reload preview' } ) ).toBeVisible();
		await waitFor( () =>
			expect( !! screen.queryByRole( 'button', { name: 'Annotate' } ) ).toBe( shown )
		);
	} );

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
