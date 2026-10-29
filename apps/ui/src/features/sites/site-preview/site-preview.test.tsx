import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/agent/protocol/chat-artifacts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useSyncExternalStore, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateResponsivePreview } from '@/data/responsive-preview';
import { SessionUIProvider } from '@/data/use-session-ui';
import { getSiteAnnotations } from '@/features/annotations';
import { ALL_CAPABILITIES, createFakeConnector, makeSite } from '@/test/fake-connector';
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
			const particles = document.querySelector( 'canvas' );
			expect( particles ).toBeInTheDocument();
			expect( logo() ).toBeInTheDocument();
			expect( page() ).toBeNull();
			expect( screen.getByText( 'Loading site preview' ) ).toBeInTheDocument();
			update( { site: makeSite( { id: 'one', port: 9010, running: true } ) } );
			expect( isPageHidden() ).toBe( true );
			expect( document.querySelector( 'canvas' ) ).toBe( particles );
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
			expect( document.querySelectorAll( 'canvas' ) ).toHaveLength( 1 );
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
		expect( address() ).toHaveValue( 'http://localhost:8001' );
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

	it( 'switches realms from the address menu, recording only real switches', async () => {
		const connector = createFakeConnector();
		const onPathChange = vi.fn();
		const { update } = await renderPreview( 'browser', { onPathChange }, connector );
		const pick = async ( name: string ) => {
			fireEvent.click( screen.getByRole( 'textbox', { name: 'Address' } ) );
			fireEvent.click( await screen.findByRole( 'option', { name } ) );
		};
		await pick( 'WordPress Admin' );
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
		await pick( 'WordPress Admin' );
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

	it( 'starts a stopped site with annotation mode selected', async () => {
		const connector = createFakeConnector( {}, { capabilities: ALL_CAPABILITIES } );
		const stopped = makeSite( { id: 'annotate-stopped', running: false } );
		const { user } = await renderPreview( 'desktop', { site: stopped }, connector );
		const annotate = screen.getByRole( 'button', { name: 'Annotate' } );
		expect( annotate ).toBeEnabled();
		await user.click( annotate );
		expect( connector.startSite ).toHaveBeenCalledWith( stopped.id );
		expect( getSiteAnnotations( stopped.id ).active ).toBe( true );
	} );

	it.each( [ true, false ] )(
		'keeps Annotate visible when host support is %s',
		async ( annotatePreview ) => {
			const connector = createFakeConnector(
				{},
				{ capabilities: { ...ALL_CAPABILITIES, annotatePreview } }
			);
			await renderPreview( 'browser', {}, connector );
			expect( screen.getByRole( 'button', { name: 'Reload preview' } ) ).toBeVisible();
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
			expect( responsiveToggle() ).toBeDisabled();
			expect(
				screen.queryByRole( 'toolbar', { name: 'Responsive preview' } )
			).not.toBeInTheDocument();
			update( { path: DESIGN_SYSTEM_PREVIEW_PATH } );
			expect( responsiveToggle() ).toBeDisabled();
			expect(
				screen.queryByRole( 'toolbar', { name: 'Responsive preview' } )
			).not.toBeInTheDocument();
			update( { path: '/wp-admin/' } );
			expect( responsiveToggle() ).toBeEnabled();
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

describe( 'preview address bar', () => {
	it( 'shows immediate startup feedback and restores the address when running', async () => {
		const { update } = await renderPreview( 'browser', {
			site: site( { running: false, operation: { pid: 1, kind: 'start' } } ),
		} );
		expect( screen.getByText( 'Starting site…' ) ).toHaveAttribute( 'role', 'status' );
		expect( screen.queryByRole( 'textbox' ) ).not.toBeInTheDocument();
		update( { site: site() } );
		expect( screen.queryByText( 'Starting site…' ) ).not.toBeInTheDocument();
		expect( address() ).toHaveValue( SITE_URL );
	} );

	it( 'shows stopping feedback until shutdown completes, even after the preview is hidden', async () => {
		const stopping = { pid: 1, kind: 'stop' } as const;
		const { update } = await renderPreview( 'browser', {
			path: '/about/',
			site: site( { operation: stopping } ),
		} );
		expect( screen.getByText( 'Stopping site…' ) ).toHaveAttribute( 'role', 'status' );
		expect( screen.queryByRole( 'textbox' ) ).not.toBeInTheDocument();
		update( { site: site( { running: false, operation: stopping } ) } );
		expect( screen.getByText( 'Stopping site…' ) ).toHaveAttribute( 'role', 'status' );
		update( { site: site( { running: false } ) } );
		expect( screen.queryByText( 'Stopping site…' ) ).not.toBeInTheDocument();
		update( { site: site() } );
		expect( address() ).toHaveValue( `${ SITE_URL }/about/` );
	} );

	it( 'toggles responsive mode from the address field', async () => {
		const { user } = await renderPreview( 'browser', {
			site: site( { id: 'address-responsive' } ),
		} );
		const toggle = screen.getByRole( 'button', { name: 'Responsive mode' } );
		expect( address().closest( 'form' ) ).toContainElement( toggle );
		await user.click( toggle );
		expect( toggle ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( address() ).not.toHaveFocus();
		expect( screen.queryByRole( 'dialog', { name: 'Preview shortcuts' } ) ).not.toBeInTheDocument();
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

	it( 'keeps an empty pill while stopped and restores the editable address when started', async () => {
		const { update } = await renderPreview( 'browser', { path: '/about/' } );
		expect( address() ).toHaveValue( `${ SITE_URL }/about/` );
		update( { site: site( { running: false } ) } );
		expect( screen.queryByRole( 'textbox', { name: 'Address' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Start site' } ) ).not.toBeInTheDocument();
		update( { site: site( { running: false, operation: { pid: 1, kind: 'settings' } } ) } );
		expect( screen.queryByRole( 'button', { name: 'Responsive mode' } ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Open this page in your browser' } )
		).not.toBeInTheDocument();
		update( { site: site() } );
		expect( address() ).toHaveValue( `${ SITE_URL }/about/` );
		expect( address() ).toBeEnabled();
		expect( screen.getByRole( 'button', { name: 'Responsive mode' } ) ).toBeInTheDocument();
	} );

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
