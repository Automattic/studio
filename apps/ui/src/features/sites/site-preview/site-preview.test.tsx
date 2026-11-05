import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/agent/protocol/chat-artifacts';
import { READ_ADMIN_BAR_VISIBILITY_SCRIPT } from '@studio/common/lib/preview-shortcuts-script';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useSyncExternalStore, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVisibleToasts } from '@/data/app-messages';
import { useSites } from '@/data/queries/use-sites';
import { USER_PREFERENCES_QUERY_KEY } from '@/data/queries/use-user-preferences';
import { updateResponsivePreview } from '@/data/responsive-preview';
import { SessionUIProvider } from '@/data/use-session-ui';
import {
	changeAnnotation,
	pickAnnotation,
	stageAnnotations,
	setAnnotating,
	removeAnnotations,
	requestAnnotationReview,
} from '@/features/annotations';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SiteHeaderActionsProvider } from '../site-header-actions';
import { setPreviewColorScheme } from './preview-browser-settings';
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
	const { data: sites } = useSites();
	const currentSite = sites?.find( ( site ) => site.id === props.site.id ) ?? props.site;
	return (
		<SiteHeaderActionsProvider host="panel">
			<SessionUIProvider>
				<SitePreview { ...props } site={ currentSite } />
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
	await screen.findByRole( 'complementary', { name: 'Panel' } );
	return { ...view, update: store.update };
}

type Guest = HTMLElement & {
	reload: ReturnType< typeof vi.fn >;
	loadURL: ReturnType< typeof vi.fn >;
	adminBarVisible: boolean;
};

function page() {
	return document.querySelector< HTMLElement >( 'iframe, webview' );
}

function guest( extra: Record< string, unknown > = {} ) {
	const element = document.querySelector( 'webview' ) as Guest;
	Object.assign( element, {
		loadURL: vi.fn( async () => {} ),
		reload: vi.fn(),
		adminBarVisible: false,
		executeJavaScript: vi.fn( async ( script: string ) =>
			script === READ_ADMIN_BAR_VISIBILITY_SCRIPT ? element.adminBarVisible : undefined
		),
		getWebContentsId: () => 42,
		...extra,
	} );
	return element;
}

const frameNavigationIds = new WeakMap< HTMLElement, number >();

function finishLoading( runtime: Runtime ) {
	const element = page()!;
	if ( runtime === 'desktop' ) {
		fireEvent( element, new Event( 'did-finish-load' ) );
		fireEvent( element, new Event( 'did-stop-loading' ) );
	} else {
		const postMessage = vi.spyOn( ( element as HTMLIFrameElement ).contentWindow!, 'postMessage' );
		fireEvent.load( element );
		const init = postMessage.mock.calls
			.filter( ( [ message ] ) => message.type === 'studio:preview-shortcuts:init' )
			.at( -1 )!;
		frameNavigationIds.set( element, init[ 0 ].navigationId );
	}
}

function reportAdminBarVisibility( runtime: Runtime, visible: boolean, url?: string ) {
	const element = page()!;
	if ( runtime === 'desktop' ) {
		( element as Guest ).adminBarVisible = visible;
		const requested = ( element as Guest ).loadURL.mock.calls.at( -1 )?.[ 0 ] as string | undefined;
		const redirected = requested && new URL( requested ).searchParams.get( 'redirect_to' );
		const actualUrl = url ?? redirected;
		fireEvent(
			element,
			Object.assign( new Event( 'did-navigate' ), actualUrl ? { url: actualUrl } : {} )
		);
		fireEvent( element, new Event( 'did-stop-loading' ) );
	} else {
		if ( ! frameNavigationIds.has( element ) ) finishLoading( runtime );
		fireEvent(
			window,
			new MessageEvent( 'message', {
				source: ( element as HTMLIFrameElement ).contentWindow,
				origin: SITE_URL,
				data: {
					type: 'studio:preview:admin-bar-state',
					visible,
					url: url ?? ( element as HTMLIFrameElement ).src,
					navigationId: frameNavigationIds.get( element ),
				},
			} )
		);
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
		expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue( 'Email log' );
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
		expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue( 'Email log' );
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
		expect( input ).toHaveValue( 'Email log' );
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
			expect( screen.getByRole( 'button', { name: 'Email log E' } ) ).toBeVisible();
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
		fireEvent.pointerUp( input, { button: 0 } );
	} );
} );

describe( 'preview browser menu', () => {
	async function openBrowserOptions( user: { keyboard: ( keys: string ) => Promise< void > } ) {
		act( () => screen.getByRole( 'button', { name: 'Browser options' } ).focus() );
		await user.keyboard( '{ArrowDown}' );
	}
	afterEach( () => {
		setPreviewColorScheme( 'system' );
		localStorage.removeItem( 'studio-preview-recent-locations:one' );
		localStorage.removeItem( 'studio-preview-recent-locations:other' );
		localStorage.removeItem( 'studio-test-keep' );
	} );

	it( 'offers the agreed actions and opens DevTools for the active preview', async () => {
		const { user } = await renderPreview( 'desktop' );
		const openWebviewDevTools = vi.fn().mockResolvedValue( undefined );
		vi.stubGlobal( 'ipcApi', { openWebviewDevTools } );
		guest();
		screen.getByRole( 'button', { name: 'Browser options' } ).focus();
		await user.keyboard( '{ArrowDown}' );
		expect( screen.getAllByRole( 'menuitem' ).map( ( item ) => item.textContent ) ).toEqual( [
			'Open DevTools',
			'Appearance',
			'Admin bar',
			'Clear browsing data',
		] );
		await user.click( screen.getByRole( 'menuitem', { name: 'Open DevTools' } ) );
		expect( openWebviewDevTools ).toHaveBeenCalledExactlyOnceWith( 42 );
	} );

	it( 'keeps reload in the toolbar and opens the current page externally', async () => {
		const connector = createFakeConnector( { preferences: { browser: 'safari' } } );
		const { user } = await renderPreview( 'desktop', { path: '/about/' }, connector );
		const preview = guest();
		fireEvent( preview, new Event( 'dom-ready' ) );
		expect( address().closest( 'form' ) ).not.toContainElement(
			screen.getByRole( 'button', { name: 'Browser options' } )
		);
		await user.click( screen.getByRole( 'button', { name: 'Reload preview' } ) );
		await waitFor( () => expect( clearWebviewCache() ).toHaveBeenCalledWith( 42 ) );
		expect( preview.reload ).toHaveBeenCalledOnce();
		await user.click( screen.getByRole( 'button', { name: 'Open this page in your browser' } ) );
		expect( connector.openSiteUrl ).toHaveBeenCalledWith( 'one', '/about/', { autoLogin: false } );
	} );

	it( 'changes the preview appearance without changing Studio preferences', async () => {
		const connector = createFakeConnector();
		const { user } = await renderPreview( 'desktop', {}, connector );
		const setWebviewColorScheme = vi.fn().mockResolvedValue( undefined );
		vi.stubGlobal( 'ipcApi', { setWebviewColorScheme } );
		const preview = guest();
		fireEvent( preview, new Event( 'dom-ready' ) );
		screen.getByRole( 'button', { name: 'Browser options' } ).focus();
		await user.keyboard( '{ArrowDown}' );
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Appearance' } ) );
		fireEvent.click( await screen.findByRole( 'menuitemradio', { name: 'Dark' } ) );
		await waitFor( () => expect( setWebviewColorScheme ).toHaveBeenLastCalledWith( 42, 'dark' ) );
		expect( connector.setUserPreferences ).not.toHaveBeenCalled();
	} );

	it( 'clears browsing data immediately and removes only preview recent addresses', async () => {
		const { user } = await renderPreview( 'desktop' );
		const clearWebviewBrowsingData = vi.fn().mockResolvedValue( undefined );
		vi.stubGlobal( 'ipcApi', { clearWebviewBrowsingData } );
		guest();
		localStorage.setItem( 'studio-preview-recent-locations:one', '[]' );
		localStorage.setItem( 'studio-preview-recent-locations:other', '[]' );
		localStorage.setItem( 'studio-test-keep', 'preserve' );
		screen.getByRole( 'button', { name: 'Browser options' } ).focus();
		await user.keyboard( '{ArrowDown}' );
		await user.click( screen.getByRole( 'menuitem', { name: 'Clear browsing data' } ) );
		await waitFor( () => expect( clearWebviewBrowsingData ).toHaveBeenCalledExactlyOnceWith( 42 ) );
		expect( localStorage.getItem( 'studio-preview-recent-locations:one' ) ).toBeNull();
		expect( localStorage.getItem( 'studio-preview-recent-locations:other' ) ).toBeNull();
		expect( localStorage.getItem( 'studio-test-keep' ) ).toBe( 'preserve' );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	it( 'does not offer Electron-only actions in the browser app', async () => {
		const { user } = await renderPreview( 'browser' );
		await openBrowserOptions( user );
		expect( screen.getByRole( 'menuitem', { name: 'Admin bar' } ) ).toBeVisible();
		expect( screen.queryByRole( 'menuitem', { name: 'Open DevTools' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'menuitem', { name: 'Appearance' } ) ).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Open this page in your browser' } )
		).toBeInTheDocument();
	} );

	it.each( [ 'browser', 'desktop' ] as const )(
		'disables the %s control until visibility is known and during navigation',
		async ( runtime ) => {
			const connector = createFakeConnector( { sites: [ site() ] } );
			const { user } = await renderPreview( runtime, {}, connector );
			const before = runtime === 'desktop' ? guest() : page()!;
			await openBrowserOptions( user );
			expect( screen.getByRole( 'menuitem', { name: 'Admin bar' } ) ).toHaveAttribute(
				'aria-disabled',
				'true'
			);
			await user.keyboard( '{Escape}' );
			if ( runtime === 'desktop' ) fireEvent( before, new Event( 'dom-ready' ) );
			finishLoading( runtime );
			reportAdminBarVisibility( runtime, true );
			await openBrowserOptions( user );
			fireEvent.click( screen.getByRole( 'menuitem', { name: 'Admin bar' } ) );
			const hide = await screen.findByRole( 'menuitemradio', { name: 'Hide' } );
			if ( runtime === 'desktop' ) {
				fireEvent(
					before,
					Object.assign( new Event( 'did-start-navigation' ), {
						isMainFrame: true,
						isInPlace: false,
					} )
				);
				fireEvent( before, new Event( 'did-start-loading' ) );
			} else
				fireEvent(
					window,
					new MessageEvent( 'message', {
						source: ( before as HTMLIFrameElement ).contentWindow,
						origin: SITE_URL,
						data: {
							type: 'studio:preview:navigating',
							navigationId: frameNavigationIds.get( before ),
						},
					} )
				);
			expect( hide ).toHaveAttribute( 'aria-disabled', 'true' );
			fireEvent.click( hide );
			expect( connector.setSiteFrontendAdminBar ).not.toHaveBeenCalled();
		}
	);

	it.each( [ 'browser', 'desktop' ] as const )(
		'keeps the %s page intact when choosing its current visibility',
		async ( runtime ) => {
			const connector = createFakeConnector( { sites: [ site() ] } );
			const { user } = await renderPreview( runtime, {}, connector );
			const before = runtime === 'desktop' ? guest() : page()!;
			if ( runtime === 'desktop' ) fireEvent( before, new Event( 'dom-ready' ) );
			finishLoading( runtime );
			reportAdminBarVisibility( runtime, true );
			const postMessage =
				runtime === 'browser'
					? vi.spyOn( ( before as HTMLIFrameElement ).contentWindow!, 'postMessage' )
					: undefined;
			await openBrowserOptions( user );
			fireEvent.click( screen.getByRole( 'menuitem', { name: 'Admin bar' } ) );
			await user.click( await screen.findByRole( 'menuitemradio', { name: 'Show' } ) );
			await waitFor( () => expect( connector.setSiteFrontendAdminBar ).toHaveBeenCalledOnce() );
			await act( async () => {} );
			if ( runtime === 'desktop' ) {
				expect( ( before as Guest ).loadURL ).not.toHaveBeenCalled();
				expect( ( before as Guest ).reload ).not.toHaveBeenCalled();
			} else
				expect( postMessage ).not.toHaveBeenCalledWith(
					{ type: 'studio:preview:login' },
					SITE_URL
				);
			expect( page() ).toBe( before );
		}
	);

	it( 'tracks iframe navigation through WP Admin and logout without remounting or remembering authentication pages', async () => {
		const connector = createFakeConnector( { sites: [ site() ] } );
		let updatePath: ( patch: Partial< Props > ) => void = () => {};
		const { user, update } = await renderPreview(
			'browser',
			{ onPathChange: ( path ) => updatePath( { path } ) },
			connector
		);
		updatePath = update;
		const before = page()!;
		finishLoading( 'browser' );
		for ( const path of [ '/wp-admin/', '/wp-login.php?action=logout&_wpnonce=example', '/' ] ) {
			reportAdminBarVisibility( 'browser', path === '/wp-admin/', `${ SITE_URL }${ path }` );
			expect( address() ).toHaveValue( `${ SITE_URL }${ path === '/' ? '' : path }` );
			expect( page() ).toBe( before );
			if ( path !== '/' )
				expect(
					screen.queryByRole( 'button', { name: 'Browser options' } )
				).not.toBeInTheDocument();
		}
		await openBrowserOptions( user );
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Admin bar' } ) );
		expect( await screen.findByRole( 'menuitemradio', { name: 'Hide' } ) ).toBeChecked();
		expect( connector.setSiteFrontendAdminBar ).not.toHaveBeenCalled();
		expect( localStorage.getItem( 'studio-preview-recent-locations:one' ) ?? '' ).not.toContain(
			'_wpnonce'
		);
	} );

	it( 'does not reload WP Admin when the Studio default changes', async () => {
		const { queryClient } = await renderPreview( 'desktop', {
			path: '/wp-admin/post.php?post=1&action=edit',
		} );
		const before = guest();
		fireEvent( before, new Event( 'dom-ready' ) );
		finishLoading( 'desktop' );
		await act( async () =>
			queryClient.setQueryData( USER_PREFERENCES_QUERY_KEY, ( current: object ) => ( {
				...current,
				hideFrontendAdminBar: true,
			} ) )
		);
		expect( before.loadURL ).not.toHaveBeenCalled();
		expect( before.reload ).not.toHaveBeenCalled();
	} );

	it.each( [
		[ 'browser', false ],
		[ 'desktop', false ],
		[ 'browser', true ],
		[ 'desktop', true ],
	] as const )(
		'saves a %s site override before navigating and can return to the default (hidden: %s)',
		async ( runtime, defaultHidden ) => {
			const connector = createFakeConnector( {
				sites: [ site() ],
				preferences: { hideFrontendAdminBar: defaultHidden },
			} );
			const defaultLabel = defaultHidden ? 'Hide' : 'Show';
			const overrideLabel = defaultHidden ? 'Show' : 'Hide';
			let finishSave = () => {};
			connector.setSiteFrontendAdminBar.mockImplementationOnce(
				( _siteId, hidden ) =>
					new Promise< void >( ( resolve ) => {
						finishSave = () => {
							connector.state.sites[ 0 ].hideFrontendAdminBar = hidden ?? undefined;
							resolve();
						};
					} )
			);
			const { user } = await renderPreview( runtime, {}, connector );
			const before = runtime === 'desktop' ? guest() : page()!;
			if ( runtime === 'desktop' ) fireEvent( before, new Event( 'dom-ready' ) );
			finishLoading( runtime );
			reportAdminBarVisibility( runtime, ! defaultHidden );
			const openAdminBar = async () => {
				await openBrowserOptions( user );
				fireEvent.click( screen.getByRole( 'menuitem', { name: 'Admin bar' } ) );
				return screen.findByRole( 'menuitemradio', { name: defaultLabel } );
			};
			await openAdminBar();
			await waitFor( () =>
				expect( screen.getByRole( 'menuitemradio', { name: defaultLabel } ) ).toBeChecked()
			);
			expect( screen.getAllByRole( 'menuitemradio' ) ).toHaveLength( 2 );
			await user.click( screen.getByRole( 'menuitemradio', { name: overrideLabel } ) );
			await waitFor( () =>
				expect( connector.setSiteFrontendAdminBar ).toHaveBeenCalledWith( 'one', ! defaultHidden )
			);
			if ( runtime === 'desktop' ) expect( ( before as Guest ).reload ).not.toHaveBeenCalled();
			else expect( page() ).toBe( before );
			await act( async () => finishSave() );
			await waitFor( () => {
				if ( runtime !== 'desktop' ) {
					if ( defaultHidden ) expect( page() ).toBe( before );
					else expect( page() ).not.toBe( before );
				} else if ( defaultHidden )
					expect( ( before as Guest ).loadURL ).toHaveBeenCalledWith(
						expect.stringContaining( '/studio-auto-login?' )
					);
				else expect( ( before as Guest ).reload ).toHaveBeenCalledOnce();
			} );
			reportAdminBarVisibility( runtime, defaultHidden );
			await openAdminBar();
			await waitFor( () =>
				expect( screen.getByRole( 'menuitemradio', { name: overrideLabel } ) ).toBeChecked()
			);
			await user.click( screen.getByRole( 'menuitemradio', { name: defaultLabel } ) );
			await waitFor( () =>
				expect( connector.setSiteFrontendAdminBar ).toHaveBeenLastCalledWith( 'one', null )
			);
			reportAdminBarVisibility( runtime, ! defaultHidden );
			await openAdminBar();
			await waitFor( () =>
				expect( screen.getByRole( 'menuitemradio', { name: defaultLabel } ) ).toBeChecked()
			);
		}
	);

	it.each( [ 'browser', 'desktop' ] as const )(
		'signs in from the logged-out %s Show action after saving',
		async ( runtime ) => {
			const connector = createFakeConnector( { sites: [ site() ] } );
			let finish = () => {};
			connector.setSiteFrontendAdminBar.mockImplementationOnce(
				() => new Promise< void >( ( resolve ) => ( finish = resolve ) )
			);
			const onPathChange = vi.fn();
			const path = '/sample-page/?preview=1#details';
			const { user } = await renderPreview( runtime, { path, onPathChange }, connector );
			const before = runtime === 'desktop' ? guest() : page()!;
			if ( runtime === 'desktop' ) fireEvent( before, new Event( 'dom-ready' ) );
			finishLoading( runtime );
			reportAdminBarVisibility( runtime, false );
			const postMessage =
				runtime === 'browser'
					? vi.spyOn( ( before as HTMLIFrameElement ).contentWindow!, 'postMessage' )
					: undefined;
			await openBrowserOptions( user );
			fireEvent.click( screen.getByRole( 'menuitem', { name: 'Admin bar' } ) );
			const show = await screen.findByRole( 'menuitemradio', { name: 'Show' } );
			expect( show ).not.toBeChecked();
			await user.click( show );
			await waitFor( () =>
				expect( connector.setSiteFrontendAdminBar ).toHaveBeenCalledWith( 'one', null )
			);
			expect( onPathChange ).not.toHaveBeenCalled();
			if ( runtime === 'desktop' ) expect( ( before as Guest ).loadURL ).not.toHaveBeenCalled();
			else expect( page() ).toBe( before );
			await act( async () => finish() );
			if ( runtime === 'browser' ) {
				await waitFor( () =>
					expect( postMessage ).toHaveBeenCalledWith( { type: 'studio:preview:login' }, SITE_URL )
				);
				expect( onPathChange ).not.toHaveBeenCalled();
				expect( page() ).toBe( before );
				expect( page() ).toHaveAttribute( 'src', `${ SITE_URL }${ path }` );
				return;
			}
			await waitFor( () => expect( onPathChange ).toHaveBeenCalledOnce() );
			const loginUrl = new URL( onPathChange.mock.calls[ 0 ][ 0 ], SITE_URL );
			expect( loginUrl.pathname ).toBe( '/studio-auto-login' );
			expect( loginUrl.searchParams.get( 'redirect_to' ) ).toBe( `${ SITE_URL }${ path }` );
			await waitFor( () =>
				expect( ( before as Guest ).loadURL ).toHaveBeenCalledWith( loginUrl.toString() )
			);
			expect( ( before as Guest ).reload ).not.toHaveBeenCalled();
		}
	);

	it.each( [
		[ 'browser', 'site' ],
		[ 'desktop', 'site' ],
		[ 'browser', 'admin' ],
		[ 'desktop', 'admin' ],
		[ 'browser', 'collapsed' ],
		[ 'desktop', 'collapsed' ],
		[ 'browser', 'page' ],
		[ 'desktop', 'page' ],
	] as const )(
		'does not sign in after leaving the %s preview during a save (%s)',
		async ( runtime, destination ) => {
			const connector = createFakeConnector( {
				sites: [ site(), site( { id: 'two', name: 'Second site' } ) ],
			} );
			let finish = () => {};
			connector.setSiteFrontendAdminBar.mockImplementationOnce(
				() => new Promise< void >( ( resolve ) => ( finish = resolve ) )
			);
			const onPathChange = vi.fn();
			const { user, update } = await renderPreview( runtime, { onPathChange }, connector );
			const before = runtime === 'desktop' ? guest() : page()!;
			if ( runtime === 'desktop' ) fireEvent( before, new Event( 'dom-ready' ) );
			finishLoading( runtime );
			reportAdminBarVisibility( runtime, false );
			const postMessage =
				runtime === 'browser'
					? vi.spyOn( ( before as HTMLIFrameElement ).contentWindow!, 'postMessage' )
					: undefined;
			await openBrowserOptions( user );
			fireEvent.click( screen.getByRole( 'menuitem', { name: 'Admin bar' } ) );
			await user.click( await screen.findByRole( 'menuitemradio', { name: 'Show' } ) );
			await waitFor( () => expect( connector.setSiteFrontendAdminBar ).toHaveBeenCalledOnce() );
			update(
				destination === 'site'
					? { site: site( { id: 'two', name: 'Second site' } ) }
					: destination === 'admin'
					? { path: '/wp-admin/' }
					: destination === 'page'
					? { path: '/sample-page/' }
					: { collapsed: true }
			);
			await act( async () => finish() );
			expect( onPathChange ).not.toHaveBeenCalledWith(
				expect.stringContaining( '/studio-auto-login' )
			);
			if ( postMessage )
				expect( postMessage ).not.toHaveBeenCalledWith(
					{ type: 'studio:preview:login' },
					SITE_URL
				);
			expect( page()!.getAttribute( 'src' ) ).not.toContain( '/studio-auto-login' );
		}
	);

	it.each( [
		[ 'browser', false, undefined ],
		[ 'desktop', false, undefined ],
		[ 'browser', true, undefined ],
		[ 'desktop', true, undefined ],
		[ 'browser', true, false ],
		[ 'desktop', true, false ],
		[ 'browser', false, true ],
		[ 'desktop', false, true ],
	] as const )(
		'reflects the %s page across login without changing preferences (default: %s, override: %s)',
		async ( runtime, defaultHidden, hideFrontendAdminBar ) => {
			const connector = createFakeConnector( {
				sites: [ site( { hideFrontendAdminBar } ) ],
				preferences: { hideFrontendAdminBar: defaultHidden },
			} );
			const { user } = await renderPreview( runtime, {}, connector );
			if ( runtime === 'desktop' ) {
				guest();
				fireEvent( page()!, new Event( 'dom-ready' ) );
			}
			finishLoading( runtime );
			reportAdminBarVisibility( runtime, false );
			await openBrowserOptions( user );
			fireEvent.click( screen.getByRole( 'menuitem', { name: 'Admin bar' } ) );
			await waitFor( () =>
				expect( screen.getByRole( 'menuitemradio', { name: 'Hide' } ) ).toBeChecked()
			);
			const visibleAfterLogin = ! ( hideFrontendAdminBar ?? defaultHidden );
			reportAdminBarVisibility( runtime, visibleAfterLogin );
			await waitFor( () =>
				expect(
					screen.getByRole( 'menuitemradio', {
						name: visibleAfterLogin ? 'Show' : 'Hide',
					} )
				).toBeChecked()
			);
			expect( connector.setSiteFrontendAdminBar ).not.toHaveBeenCalled();
			expect( connector.setUserPreferences ).not.toHaveBeenCalled();
			expect( connector.state.sites[ 0 ].hideFrontendAdminBar ).toBe( hideFrontendAdminBar );
			expect( page()!.getAttribute( 'src' ) ).not.toContain( '/studio-auto-login' );
		}
	);

	it.each( [ 'Show', 'Hide' ] )(
		'keeps the selected value and page intact when %s fails',
		async ( value ) => {
			const connector = createFakeConnector( {
				sites: [ site( { hideFrontendAdminBar: value === 'Show' } ) ],
			} );
			connector.setSiteFrontendAdminBar.mockRejectedValueOnce( new Error( 'Disk full' ) );
			const { user } = await renderPreview( 'browser', {}, connector );
			const before = page();
			reportAdminBarVisibility( 'browser', value === 'Hide' );
			await openBrowserOptions( user );
			fireEvent.click( screen.getByRole( 'menuitem', { name: 'Admin bar' } ) );
			await user.click( await screen.findByRole( 'menuitemradio', { name: value } ) );
			await waitFor( () =>
				expect( getVisibleToasts() ).toContainEqual(
					expect.objectContaining( {
						title: 'Could not update the admin bar setting. Please try again.',
						intent: 'error',
					} )
				)
			);
			expect( page() ).toBe( before );
			await openBrowserOptions( user );
			fireEvent.click( screen.getByRole( 'menuitem', { name: 'Admin bar' } ) );
			expect(
				await screen.findByRole( 'menuitemradio', { name: value === 'Show' ? 'Hide' : 'Show' } )
			).toBeChecked();
		}
	);

	it( 'applies a pending save to its original site after switching sites', async () => {
		const connector = createFakeConnector( {
			sites: [ site(), site( { id: 'two', name: 'Second site' } ) ],
		} );
		let finish = () => {};
		connector.setSiteFrontendAdminBar.mockImplementationOnce(
			() =>
				new Promise< void >( ( resolve ) => {
					finish = resolve;
				} )
		);
		const { user, update, queryClient } = await renderPreview( 'browser', {}, connector );
		reportAdminBarVisibility( 'browser', true );
		await openBrowserOptions( user );
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Admin bar' } ) );
		await user.click( await screen.findByRole( 'menuitemradio', { name: 'Hide' } ) );
		await waitFor( () =>
			expect( connector.setSiteFrontendAdminBar ).toHaveBeenCalledWith( 'one', true )
		);
		update( { site: site( { id: 'two', name: 'Second site' } ) } );
		await act( async () => finish() );
		await waitFor( () => {
			const sites = queryClient.getQueryData< Props[ 'site' ][] >( [ 'sites' ] );
			expect( sites?.find( ( site ) => site.id === 'one' )?.hideFrontendAdminBar ).toBe( true );
			expect( sites?.find( ( site ) => site.id === 'two' )?.hideFrontendAdminBar ).toBeUndefined();
		} );
	} );

	it.each( [
		'/wp-admin/',
		'/wp-login.php',
		'/wp-login.php?action=logout&_wpnonce=test',
		'/wp-signup.php',
		'/wp-activate.php?key=test',
		'/studio-auto-login?redirect_to=http%3A%2F%2Flocalhost%3A9010%2F',
		'/phpmyadmin/',
		'studio:email',
		DESIGN_SYSTEM_PREVIEW_PATH,
	] )( 'does not offer the local frontend setting on %s', async ( path ) => {
		const { user } = await renderPreview( 'desktop', { path } );
		const options = screen.queryByRole( 'button', { name: 'Browser options' } );
		if ( options ) {
			await openBrowserOptions( user );
			expect( screen.queryByRole( 'menuitem', { name: 'Admin bar' } ) ).not.toBeInTheDocument();
		}
	} );

	it( 'does not offer guest browser actions for the rendered email surface', async () => {
		await renderPreview( 'desktop', { path: 'studio:email' } );
		expect( await screen.findByText( 'No email yet' ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Browser options' } ) ).not.toBeInTheDocument();
	} );

	it( 'does not offer guest browser actions for the rendered design surface', async () => {
		await renderPreview( 'desktop', { path: DESIGN_SYSTEM_PREVIEW_PATH } );
		expect( screen.queryByRole( 'button', { name: 'Browser options' } ) ).not.toBeInTheDocument();
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
			const { update } = await renderPreview(
				runtime,
				{ onPathChange, onSendAnnotations: vi.fn() },
				createFakeConnector( { emails: { one: [ email ] } } )
			);
			for ( const part of [ 'text', 'html' ] as const ) {
				act( () => requestAnnotationReview( 'one', ids[ part === 'text' ? 0 : 1 ] ) );
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
				expect( await screen.findByRole( 'textbox', { name: 'Describe the change' } ) ).toHaveValue(
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
