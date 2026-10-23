import { INSPECTOR_BRIDGE_PREFIX } from '@studio/common/ai/inspector/page-script';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { WindowControlsCornerContext } from '@/hooks/use-window-controls-inset';
import { useWindowControlsOverlay } from '@/hooks/use-window-controls-overlay';
import {
	getBrowserShortcutCommand,
	getDirectionalHistoryEntries,
	isOffOriginRedirect,
	getPathFromPreviewUrl,
	SitePreview,
} from './index';
import type { SiteDetails } from '@/data/core';
import type { ComponentProps, ReactNode } from 'react';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-agentic-features', () => ( {
	useAgenticFeatures: vi.fn( () => ( {
		enabled: true,
		chatEnabled: true,
		chatPromptsSignIn: false,
		reason: null,
		isReady: true,
	} ) ),
} ) );

// jsdom has no 2D canvas context, so swap the animated grid for a bare canvas.
vi.mock( '@/components/share-dialog', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@/components/share-dialog') >() ),
	ShareButton: () => null,
} ) );

vi.mock( '@/components/stopped-site-preview', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@/components/stopped-site-preview') >() ),
	SiteContextMenu: ( { children }: { children: ReactNode } ) => children,
} ) );

vi.mock( '@/components/dot-grid', () => ( {
	DotGrid: () => <canvas data-testid="dot-grid" />,
} ) );

vi.mock( '@/hooks/use-traffic-light-space', () => ( {
	useTrafficLightSpace: vi.fn( () => ( { start: false, end: false } ) ),
} ) );

vi.mock( '@/hooks/use-window-controls-overlay', () => ( {
	useWindowControlsOverlay: vi.fn( () => null ),
} ) );

const useConnectorMock = vi.mocked( useConnector );

// Browser-style capabilities (no native dialogs, no preview annotation) — the
// component reads `connector.capabilities` to decide which toolbar controls show.
const CAPABILITIES = {
	nativeFolderPicker: false,
	annotatePreview: false,
};

function renderPreview( children: ReactNode ) {
	const queryClient = new QueryClient( {
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	} );
	const renderResult = render(
		<QueryClientProvider client={ queryClient }>
			<TooltipProvider>{ children }</TooltipProvider>
		</QueryClientProvider>
	);
	return { ...renderResult, queryClient };
}

function createSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	return {
		id: 'site-1',
		name: 'Example Site',
		path: '/Users/example/Studio/example-site',
		port: 8881,
		running: false,
		phpVersion: '8.3',
		...overrides,
	};
}

describe( 'SitePreview', () => {
	// The browser fallback asks the site's server whether a framed page is there.
	const probeSite = vi.fn();
	beforeEach( () => {
		probeSite.mockReset().mockResolvedValue( new Response() );
		vi.stubGlobal( 'fetch', probeSite );
	} );
	afterEach( () => vi.unstubAllGlobals() );

	it( 'orders back and forward history from the current page outward', () => {
		const entries = [
			{ index: 0, title: 'Home', url: 'http://localhost/' },
			{ index: 1, title: 'Posts', url: 'http://localhost/posts' },
			{ index: 2, title: 'Editor', url: 'http://localhost/editor' },
			{ index: 3, title: 'Settings', url: 'http://localhost/settings' },
			{ index: 4, title: 'Themes', url: 'http://localhost/themes' },
		];

		expect(
			getDirectionalHistoryEntries( entries, 2, 'back' ).map( ( entry ) => entry.index )
		).toEqual( [ 1, 0 ] );
		expect(
			getDirectionalHistoryEntries( entries, 2, 'forward' ).map( ( entry ) => entry.index )
		).toEqual( [ 3, 4 ] );
	} );

	it( 'hides the browser controls and shows the stopped preview treatment when the site is not running', async () => {
		const getSiteThumbnail = vi.fn().mockResolvedValue( 'data:image/png;base64,thumbnail' );
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			getSiteThumbnail,
			capabilities: CAPABILITIES,
		} as never );

		const { container } = renderPreview(
			<SitePreview site={ createSite() } path="/wp-admin/" reloadNonce={ 0 } />
		);

		expect( screen.queryByRole( 'button', { name: 'Reload preview' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Annotate' } ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'WordPress' ) ).not.toBeInTheDocument();
		expect( container.querySelector( 'canvas' ) ).toBeInTheDocument();
		await waitFor( () => expect( getSiteThumbnail ).toHaveBeenCalledWith( 'site-1' ) );

		expect( await screen.findByRole( 'img', { name: 'Saved site preview' } ) ).toHaveAttribute(
			'src',
			'data:image/png;base64,thumbnail'
		);
		expect( screen.getByRole( 'button', { name: 'Start from preview' } ) ).toBeEnabled();
	} );

	it( 'does not render the chat-level Open in control in the preview toolbar', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview( <SitePreview site={ createSite() } path="/" reloadNonce={ 0 } /> );

		expect( screen.queryByRole( 'button', { name: 'Open in…' } ) ).not.toBeInTheDocument();
	} );

	it( 'shows a refresh button, and no history arrows before there is history', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		const { container } = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		const refreshButton = screen.getByRole( 'button', { name: 'Reload preview' } );
		expect( refreshButton ).toBeEnabled();
		expect( refreshButton ).toHaveAttribute( 'aria-keyshortcuts', expect.stringMatching( /\+R$/ ) );
		// No history yet, so no back or forward.
		expect( screen.queryByRole( 'button', { name: 'Back' } ) ).not.toBeInTheDocument();

		const initialIframe = container.querySelector( 'iframe' );
		expect( initialIframe ).toBeInTheDocument();

		fireEvent.click( refreshButton );

		expect( container.querySelector( 'iframe' ) ).not.toBe( initialIframe );
	} );

	it( 'keeps the page that loaded as the site screenshot', async () => {
		const captureSitePreview = vi.fn().mockResolvedValue( 'data:image/png;base64,new' );
		useConnectorMock.mockReturnValue( {
			captureSitePreview,
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		const { container } = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/about/" reloadNonce={ 0 } />
		);
		const iframe = container.querySelector( 'iframe' )!;
		for ( const [ key, value ] of Object.entries( { clientWidth: 800, clientHeight: 600 } ) ) {
			Object.defineProperty( iframe.closest( 'div[class*="previewViewport"]' ), key, { value } );
		}

		fireEvent.load( iframe );

		await waitFor( () =>
			expect( captureSitePreview ).toHaveBeenCalledWith( 'site-1', {
				path: '/about/',
				width: 800,
				height: 600,
				guestId: undefined,
			} )
		);
	} );

	it( 'reloads the preview on the primary-modifier+R shortcut', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		const { container } = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		const initialIframe = container.querySelector( 'iframe' );
		expect( initialIframe ).toBeInTheDocument();

		// jsdom reports a non-Apple platform, so the primary modifier is Ctrl.
		fireEvent.keyDown( document.body, { key: 'r', ctrlKey: true } );
		expect( container.querySelector( 'iframe' ) ).not.toBe( initialIframe );

		// ⌘⇧R is an alias for the same reload.
		const reloadedIframe = container.querySelector( 'iframe' );
		fireEvent.keyDown( document.body, { key: 'r', ctrlKey: true, shiftKey: true } );
		expect( container.querySelector( 'iframe' ) ).not.toBe( reloadedIframe );

		// Extra modifiers must not trigger the shortcut.
		const aliasReloadedIframe = container.querySelector( 'iframe' );
		fireEvent.keyDown( document.body, { key: 'r', ctrlKey: true, altKey: true } );
		expect( container.querySelector( 'iframe' ) ).toBe( aliasReloadedIframe );
	} );

	it( 'reloads the preview from the composer, but not from a dialog', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		const { container } = renderPreview(
			<>
				<textarea aria-label="Composer" />
				<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
			</>
		);

		const initialIframe = container.querySelector( 'iframe' );
		const composer = screen.getByRole( 'textbox', { name: 'Composer' } );
		composer.focus();
		fireEvent.keyDown( composer, { key: 'r', ctrlKey: true } );
		const reloadedIframe = container.querySelector( 'iframe' );
		expect( reloadedIframe ).not.toBe( initialIframe );

		const dialog = document.createElement( 'div' );
		dialog.dataset.slot = 'dialog-content';
		document.body.append( dialog );
		fireEvent.keyDown( dialog, { key: 'r', ctrlKey: true } );
		dialog.remove();
		expect( container.querySelector( 'iframe' ) ).toBe( reloadedIframe );
	} );

	it( 'switches realms from the address menu', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		const onPathChange = vi.fn();

		renderPreview(
			<SitePreview
				site={ createSite( { running: true } ) }
				path="/"
				reloadNonce={ 0 }
				onPathChange={ onPathChange }
			/>
		);

		fireEvent.click( screen.getByRole( 'textbox', { name: 'Address' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'WP Admin' } ) );
		expect( onPathChange ).toHaveBeenCalledWith(
			`/studio-auto-login?redirect_to=${ encodeURIComponent( 'http://localhost:8881/wp-admin/' ) }`
		);

		// Re-selecting the already-active realm is a no-op.
		onPathChange.mockClear();
		fireEvent.click( screen.getByRole( 'textbox', { name: 'Address' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Front end' } ) );
		expect( onPathChange ).not.toHaveBeenCalled();
	} );

	it( 'opens the front end externally logged out and WP Admin with auto-login', () => {
		const openSiteUrl = vi.fn().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			openSiteUrl,
			capabilities: CAPABILITIES,
		} as never );
		const site = createSite( { running: true } );

		const { rerender } = renderPreview(
			<SitePreview site={ site } path="/sample-page/" reloadNonce={ 0 } onPathChange={ vi.fn() } />
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Open this page in your browser' } ) );
		expect( openSiteUrl ).toHaveBeenLastCalledWith( 'site-1', '/sample-page/', {
			autoLogin: false,
		} );

		rerender(
			<QueryClientProvider client={ new QueryClient() }>
				<TooltipProvider>
					<SitePreview site={ site } path="/wp-admin/" reloadNonce={ 0 } onPathChange={ vi.fn() } />
				</TooltipProvider>
			</QueryClientProvider>
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Open this page in your browser' } ) );
		expect( openSiteUrl ).toHaveBeenLastCalledWith( 'site-1', '/wp-admin/', { autoLogin: true } );
	} );

	it( 'records an internal-browser Tracks event when switching realms', async () => {
		const trackEvent = vi.fn().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent,
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview
				site={ createSite( { running: true } ) }
				path="/"
				reloadNonce={ 0 }
				onPathChange={ vi.fn() }
			/>
		);

		fireEvent.click( screen.getByRole( 'textbox', { name: 'Address' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'WP Admin' } ) );
		expect( trackEvent ).toHaveBeenCalledWith( 'studio_site_open_wp_admin', {
			browser: 'internal',
		} );
	} );

	it( 'does not record a realm switch when re-selecting the active realm', async () => {
		const trackEvent = vi.fn().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent,
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview
				site={ createSite( { running: true } ) }
				path="/wp-admin/"
				reloadNonce={ 0 }
				onPathChange={ vi.fn() }
			/>
		);

		// Already on the admin realm; selecting it again is a no-op.
		fireEvent.click( screen.getByRole( 'textbox', { name: 'Address' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'WP Admin' } ) );
		expect( trackEvent ).not.toHaveBeenCalled();
	} );

	it( 'switches to the database realm from the address menu', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		const onPathChange = vi.fn();

		renderPreview(
			<SitePreview
				site={ createSite( { running: true } ) }
				path="/"
				reloadNonce={ 0 }
				onPathChange={ onPathChange }
			/>
		);

		fireEvent.click( screen.getByRole( 'textbox', { name: 'Address' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Database' } ) );
		expect( onPathChange ).toHaveBeenCalledWith(
			'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
		);
	} );

	it( 'keeps the front end and WP Admin on one shared surface', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		const ui = ( path: string ) => (
			<QueryClientProvider client={ queryClient }>
				<TooltipProvider>
					<SitePreview site={ createSite( { running: true } ) } path={ path } reloadNonce={ 0 } />
				</TooltipProvider>
			</QueryClientProvider>
		);

		const { container, rerender } = render( ui( '/' ) );
		expect( container.querySelectorAll( 'iframe' ) ).toHaveLength( 1 );

		// The two realms that link to each other and share a login stay a single
		// surface, so history and session carry across them.
		rerender( ui( '/wp-admin/' ) );
		expect( container.querySelectorAll( 'iframe' ) ).toHaveLength( 1 );
	} );

	it( 'hides the Annotate control when the host cannot annotate the preview', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		// The toolbar is present (Reload preview shows) but Annotate is omitted entirely.
		expect( screen.getByRole( 'button', { name: 'Reload preview' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Annotate' } ) ).not.toBeInTheDocument();
	} );

	it( 'shows the Annotate control when the host supports preview annotation', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: { ...CAPABILITIES, annotatePreview: true },
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeInTheDocument();
	} );

	it( 'sends a saved note from the Send bar', async () => {
		const originalUserAgent = navigator.userAgent;
		Object.defineProperty( navigator, 'userAgent', {
			configurable: true,
			value: `${ originalUserAgent } Electron/40.0.0`,
		} );
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: { ...CAPABILITIES, annotatePreview: true },
		} as never );
		const onSendAnnotations = vi.fn();
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				disconnect() {}
			}
		);

		const { container } = renderPreview(
			<SitePreview
				site={ createSite( { id: 'annotated-site', running: true } ) }
				path="/"
				reloadNonce={ 0 }
				onSendAnnotations={ onSendAnnotations }
			/>
		);
		const webview = container.querySelector( 'webview' ) as HTMLElement;
		Object.assign( webview, { executeJavaScript: vi.fn().mockResolvedValue( '' ) } );
		fireEvent( webview, new Event( 'dom-ready' ) );
		const annotate = screen.getByRole( 'button', { name: 'Annotate' } );
		await waitFor( () => expect( annotate ).toBeEnabled() );

		fireEvent.click( annotate );
		expect( annotate ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( screen.getByRole( 'button', { name: 'Reload preview' } ) ).toBeVisible();
		const pick = new Event( 'console-message' );
		Object.defineProperty( pick, 'message', {
			value: `${ INSPECTOR_BRIDGE_PREFIX }${ JSON.stringify( {
				type: 'pick',
				anchor: { left: 10, top: 10 },
				target: { selector: 'h1', tag: 'h1', url: 'http://localhost:8881/' },
			} ) }`,
		} );
		fireEvent( webview, pick );
		const note = screen.getByRole( 'textbox', { name: 'Leave a note' } );
		fireEvent.change( note, { target: { value: 'Make this bigger' } } );
		fireEvent.keyDown( note, { key: 'Enter' } );

		expect( screen.queryByRole( 'textbox', { name: 'Leave a note' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Send 1 annotation' } ) );
		expect( onSendAnnotations ).toHaveBeenCalledWith( 'annotated-site', undefined );
		expect( annotate ).toHaveAttribute( 'aria-pressed', 'false' );

		vi.unstubAllGlobals();
		Object.defineProperty( navigator, 'userAgent', {
			configurable: true,
			value: originalUserAgent,
		} );
	} );

	it( 'hides the Annotate control when agentic features are off', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: { ...CAPABILITIES, annotatePreview: true },
		} as never );
		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: true,
			chatEnabled: false,
			chatPromptsSignIn: false,
			reason: null,
			isReady: true,
		} );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		expect( screen.queryByRole( 'button', { name: 'Annotate' } ) ).not.toBeInTheDocument();

		// Restore the default for subsequent tests.
		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: true,
			chatEnabled: true,
			chatPromptsSignIn: false,
			reason: null,
			isReady: true,
		} );
	} );

	it( 'offers a retry when a framed page fails to load', async () => {
		useConnectorMock.mockReturnValue( {
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		probeSite.mockRejectedValueOnce( new TypeError( 'Failed to fetch' ) );
		const { container } = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		fireEvent.load( container.querySelector( 'iframe' )! );
		await userEvent.click( await screen.findByRole( 'button', { name: 'Try again' } ) );
		expect( screen.getByText( 'Preview could not load' ) ).toBeInTheDocument();
		fireEvent.load( container.querySelector( 'iframe' )! );

		await waitFor( () =>
			expect( screen.queryByText( 'Preview could not load' ) ).not.toBeInTheDocument()
		);
		expect( probeSite ).toHaveBeenCalledWith( 'http://localhost:8881/', expect.anything() );
	} );

	it( 'keeps the loading stage over a just-started site until its first page loads', async () => {
		let finishStart = () => {};
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn( () => new Promise< void >( ( resolve ) => ( finishStart = resolve ) ) ),
			getSiteThumbnail: vi.fn().mockResolvedValue( 'data:image/png;base64,thumbnail' ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		const { container, queryClient, rerender } = renderPreview(
			<SitePreview site={ createSite() } path="/" reloadNonce={ 0 } />
		);
		const preview = ( running: boolean ) => (
			<QueryClientProvider client={ queryClient }>
				<TooltipProvider>
					<SitePreview site={ createSite( { running } ) } path="/" reloadNonce={ 0 } />
				</TooltipProvider>
			</QueryClientProvider>
		);

		fireEvent.click( await screen.findByRole( 'button', { name: 'Start from preview' } ) );
		expect( await screen.findByText( 'Loading site preview' ) ).toBeInTheDocument();
		rerender( preview( true ) );
		finishStart();
		await waitFor( () => expect( queryClient.isMutating() ).toBe( 0 ) );
		expect( screen.getByText( 'Loading site preview' ) ).toBeInTheDocument();

		fireEvent.load( container.querySelector( 'iframe' )! );

		await waitFor( () =>
			expect( screen.queryByText( 'Loading site preview' ) ).not.toBeInTheDocument()
		);
	} );

	it( 'clears the Windows/Linux window controls while in the window corner', () => {
		const setWindowControlsSurface = vi.fn().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			setWindowControlsSurface,
			capabilities: CAPABILITIES,
		} as never );
		vi.mocked( useWindowControlsOverlay ).mockReturnValue( { height: 32, controlsWidth: 138 } );

		const preview = ( inCorner: boolean ) => (
			<QueryClientProvider client={ queryClient }>
				<TooltipProvider>
					<WindowControlsCornerContext.Provider value={ inCorner }>
						<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
					</WindowControlsCornerContext.Provider>
				</TooltipProvider>
			</QueryClientProvider>
		);
		const queryClient = new QueryClient();
		const { rerender } = render( preview( true ) );

		const header = screen.getByRole( 'button', { name: 'Reload preview' } ).parentElement
			?.parentElement?.parentElement;
		expect( header?.style.paddingRight ).toBe( '146px' );
		expect( setWindowControlsSurface ).toHaveBeenLastCalledWith( 'toolbar' );

		rerender( preview( false ) );
		expect( header?.style.paddingRight ).toBe( '' );
		expect( setWindowControlsSurface ).toHaveBeenLastCalledWith( 'chrome' );

		vi.mocked( useWindowControlsOverlay ).mockReturnValue( null );
	} );
} );

describe( 'getBrowserShortcutCommand', () => {
	// jsdom reports a non-Apple platform: primary modifier is Ctrl and the
	// navigation-arrow alias uses Alt.
	function makeEvent( overrides: Record< string, unknown > ) {
		return {
			defaultPrevented: false,
			repeat: false,
			key: '',
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			target: null,
			...overrides,
		} as unknown as KeyboardEvent;
	}

	it( 'maps the primary-modifier chords to commands', () => {
		expect( getBrowserShortcutCommand( makeEvent( { key: 'r', ctrlKey: true } ) ) ).toBe(
			'reload'
		);
		// The ⌘⇧R alias reports an uppercase key; it must still map to reload.
		expect(
			getBrowserShortcutCommand( makeEvent( { key: 'R', ctrlKey: true, shiftKey: true } ) )
		).toBe( 'reload' );
		expect( getBrowserShortcutCommand( makeEvent( { key: '[', ctrlKey: true } ) ) ).toBe( 'back' );
		expect( getBrowserShortcutCommand( makeEvent( { key: ']', ctrlKey: true } ) ) ).toBe(
			'forward'
		);
	} );

	it( 'maps the Alt+arrow aliases to back/forward', () => {
		expect( getBrowserShortcutCommand( makeEvent( { key: 'ArrowLeft', altKey: true } ) ) ).toBe(
			'back'
		);
		expect( getBrowserShortcutCommand( makeEvent( { key: 'ArrowRight', altKey: true } ) ) ).toBe(
			'forward'
		);
	} );

	it( 'ignores arrows with the wrong modifier, extra modifiers, or while editing text', () => {
		expect( getBrowserShortcutCommand( makeEvent( { key: 'ArrowLeft', ctrlKey: true } ) ) ).toBe(
			null
		);
		expect(
			getBrowserShortcutCommand( makeEvent( { key: 'ArrowLeft', altKey: true, shiftKey: true } ) )
		).toBe( null );
		expect(
			getBrowserShortcutCommand(
				makeEvent( {
					key: 'ArrowLeft',
					altKey: true,
					target: document.createElement( 'textarea' ),
				} )
			)
		).toBe( null );
	} );
} );

describe( 'isOffOriginRedirect', () => {
	it( 'flags a load that settled on another port', () => {
		expect( isOffOriginRedirect( 'http://localhost:8931/', 'http://localhost:8932/' ) ).toBe(
			true
		);
	} );

	it( 'allows same-origin paths, including the auto-login hop', () => {
		expect(
			isOffOriginRedirect( 'http://localhost:8932/wp-admin/', 'http://localhost:8932/' )
		).toBe( false );
		expect(
			isOffOriginRedirect(
				'http://localhost:8932/studio-auto-login?redirect_to=%2Fwp-admin%2F',
				'http://localhost:8932/'
			)
		).toBe( false );
	} );

	it( 'stays quiet on unparseable urls rather than triggering recovery', () => {
		expect( isOffOriginRedirect( 'about:blank', 'http://localhost:8932/' ) ).toBe( true );
		expect( isOffOriginRedirect( '', 'http://localhost:8932/' ) ).toBe( false );
		expect( isOffOriginRedirect( 'http://localhost:8932/', '' ) ).toBe( false );
	} );
} );

describe( 'getPathFromPreviewUrl', () => {
	it( 'extracts the path, search, and hash for same-origin urls', () => {
		expect(
			getPathFromPreviewUrl( 'http://localhost:8881/wp-admin/?page=1#top', 'http://localhost:8881' )
		).toBe( '/wp-admin/?page=1#top' );
	} );

	it( 'returns null for cross-origin or invalid urls', () => {
		expect( getPathFromPreviewUrl( 'https://example.com/about', 'http://localhost:8881' ) ).toBe(
			null
		);
		expect( getPathFromPreviewUrl( 'not-a-url', 'http://localhost:8881' ) ).toBe( null );
	} );
} );

// The webview surface only renders inside Electron, so these tests fake the UA
// sniff and stub the custom element's non-standard methods. Without this the
// suite only ever exercises the browser iframe fallback, which refreshes by
// remounting and so can't catch a regression in the webview reload path.
interface WebviewStub extends HTMLElement {
	loadURL: ReturnType< typeof vi.fn >;
	reload: ReturnType< typeof vi.fn >;
	executeJavaScript: ReturnType< typeof vi.fn >;
	getWebContentsId: ReturnType< typeof vi.fn >;
}

const REAL_USER_AGENT = window.navigator.userAgent;

function setUserAgent( userAgent: string ) {
	// Patched in place rather than replacing `navigator`, so the rest of it
	// (`platform`, which @wordpress/keycodes reads) stays intact.
	Object.defineProperty( window.navigator, 'userAgent', { value: userAgent, configurable: true } );
}

function renderWebviewPreview( props: Partial< ComponentProps< typeof SitePreview > > = {} ) {
	setUserAgent( `${ REAL_USER_AGENT } Electron/38.0.0` );
	const clearWebviewCache = vi.fn().mockResolvedValue( undefined );
	vi.stubGlobal( 'ipcApi', { clearWebviewCache } );
	useConnectorMock.mockReturnValue( {
		startSite: vi.fn().mockResolvedValue( undefined ),
		trackEvent: vi.fn().mockResolvedValue( undefined ),
		capabilities: CAPABILITIES,
	} as never );

	const { container, rerender } = renderPreview(
		<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } { ...props } />
	);
	const webview = container.querySelector( 'webview' ) as WebviewStub | null;
	if ( ! webview ) {
		throw new Error( 'Expected a <webview> surface' );
	}
	webview.loadURL = vi.fn().mockResolvedValue( undefined );
	webview.reload = vi.fn();
	webview.executeJavaScript = vi.fn().mockResolvedValue( undefined );
	webview.getWebContentsId = vi.fn().mockReturnValue( 7 );
	// `ready` gates every navigation; the real element emits this after load.
	fireEvent( webview, new Event( 'dom-ready' ) );

	const update = ( next: Partial< ComponentProps< typeof SitePreview > > ) =>
		rerender(
			<QueryClientProvider client={ new QueryClient() }>
				<TooltipProvider>
					<SitePreview
						site={ createSite( { running: true } ) }
						path="/"
						reloadNonce={ 0 }
						{ ...props }
						{ ...next }
					/>
				</TooltipProvider>
			</QueryClientProvider>
		);
	return { webview, clearWebviewCache, update };
}

describe( 'SitePreview webview reload', () => {
	afterEach( () => {
		vi.unstubAllGlobals();
		setUserAgent( REAL_USER_AGENT );
	} );

	it( 'drops the cache and reloads in place when the nonce bumps for the same url', async () => {
		const { webview, clearWebviewCache, update } = renderWebviewPreview();

		update( { reloadNonce: 1 } );

		await waitFor( () => expect( webview.reload ).toHaveBeenCalledTimes( 1 ) );
		expect( clearWebviewCache ).toHaveBeenCalledWith( 7 );
		expect( webview.loadURL ).not.toHaveBeenCalled();
	} );

	it( 'navigates without dropping the cache when the path changes', async () => {
		const { webview, clearWebviewCache, update } = renderWebviewPreview();

		// `preview/navigate` bumps the nonce alongside the path, so the nonce
		// alone can't stand in for "the user wants this page again".
		update( { path: '/about', reloadNonce: 1 } );

		await waitFor( () =>
			expect( webview.loadURL ).toHaveBeenCalledWith( 'http://localhost:8881/about' )
		);
		expect( webview.reload ).not.toHaveBeenCalled();
		expect( clearWebviewCache ).not.toHaveBeenCalled();
	} );

	it( 'offers a retry when the page fails to load, but not for a replaced load', async () => {
		const { webview, clearWebviewCache } = renderWebviewPreview();
		const fail = ( errorCode: number ) =>
			fireEvent(
				webview,
				Object.assign( new Event( 'did-fail-load' ), { errorCode, isMainFrame: true } )
			);

		fail( -3 );
		expect( screen.queryByText( 'Preview could not load' ) ).not.toBeInTheDocument();
		fail( -102 );
		await userEvent.click( await screen.findByRole( 'button', { name: 'Try again' } ) );

		await waitFor( () => expect( webview.reload ).toHaveBeenCalledTimes( 1 ) );
		expect( clearWebviewCache ).toHaveBeenCalledWith( 7 );
		fireEvent( webview, new Event( 'did-start-loading' ) );
		expect( screen.queryByText( 'Preview could not load' ) ).not.toBeInTheDocument();
	} );

	it( 'still reloads in place after the preview navigated itself', async () => {
		const { webview, clearWebviewCache, update } = renderWebviewPreview();

		// The guest moves on its own; the host's `path` catches up afterwards,
		// which must not be mistaken for a requested navigation.
		const navigate = new Event( 'did-navigate' ) as Event & { url: string };
		navigate.url = 'http://localhost:8881/about';
		fireEvent( webview, navigate );
		update( { path: '/about' } );
		expect( webview.loadURL ).not.toHaveBeenCalled();

		update( { path: '/about', reloadNonce: 1 } );

		await waitFor( () => expect( webview.reload ).toHaveBeenCalledTimes( 1 ) );
		expect( clearWebviewCache ).toHaveBeenCalledWith( 7 );
		expect( webview.loadURL ).not.toHaveBeenCalled();
	} );
} );
