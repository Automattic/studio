import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { describe, expect, it, vi } from 'vitest';
import { getVisibleToasts, resetAppMessagesForTests } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { INSPECTOR_BRIDGE_PREFIX } from './inspector-script';
import {
	getPathFromPreviewUrl,
	getSimulatedViewport,
	getToolbarPageTitle,
	SitePreview,
} from './index';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );

// Browser-style capabilities (no native dialogs, no preview annotation) — the
// component reads `connector.capabilities` to decide which toolbar controls show.
const CAPABILITIES = {
	nativeFolderPicker: false,
	nativeSaveDialog: false,
	openInOS: false,
	annotatePreview: false,
};

function renderPreview( children: ReactNode ) {
	const queryClient = new QueryClient( {
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	} );
	return render(
		<QueryClientProvider client={ queryClient }>
			<Tooltip.Provider>{ children }</Tooltip.Provider>
		</QueryClientProvider>
	);
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

function mockPrefersDarkColorScheme( matches: boolean ) {
	const originalMatchMedia = window.matchMedia;
	Object.defineProperty( window, 'matchMedia', {
		configurable: true,
		value: vi.fn().mockImplementation( ( query: string ) => ( {
			matches: query === '(prefers-color-scheme: dark)' ? matches : false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		} ) ),
	} );
	return () => {
		Object.defineProperty( window, 'matchMedia', {
			configurable: true,
			value: originalMatchMedia,
		} );
	};
}

function mockElectronUserAgent() {
	const originalUserAgent = window.navigator.userAgent;
	Object.defineProperty( window.navigator, 'userAgent', {
		configurable: true,
		value: `${ originalUserAgent } Electron/35.0.0`,
	} );
	return () => {
		Object.defineProperty( window.navigator, 'userAgent', {
			configurable: true,
			value: originalUserAgent,
		} );
	};
}

function mockWebviewContentsId( webContentsId = 42 ) {
	type HTMLElementWithWebviewId = HTMLElement & { getWebContentsId?: () => number };
	const prototype = HTMLElement.prototype as HTMLElementWithWebviewId;
	const original = prototype.getWebContentsId;
	Object.defineProperty( HTMLElement.prototype, 'getWebContentsId', {
		configurable: true,
		value: vi.fn( () => webContentsId ),
	} );
	return () => {
		if ( original ) {
			Object.defineProperty( HTMLElement.prototype, 'getWebContentsId', {
				configurable: true,
				value: original,
			} );
			return;
		}
		delete prototype.getWebContentsId;
	};
}

// Console, screenshot, and open-in-browser live in the trailing "•••" menu.
async function clickOverflowMenuItem( name: string ) {
	fireEvent.click( screen.getByRole( 'button', { name: 'More options' } ) );
	fireEvent.click( await screen.findByRole( 'menuitem', { name } ) );
}

function dispatchWebviewConsoleMessage(
	webview: Element,
	{
		level = 1,
		message,
		sourceId,
		line,
	}: { level?: number; message: string; sourceId?: string; line?: number }
) {
	const event = new Event( 'console-message' ) as Event & {
		level: number;
		message: string;
		sourceId?: string;
		line?: number;
	};
	event.level = level;
	event.message = message;
	event.sourceId = sourceId;
	event.line = line;
	webview.dispatchEvent( event );
}

describe( 'SitePreview', () => {
	it( 'shows the current page title and exposes the URL in a tooltip', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/wp-admin/" reloadNonce={ 0 } />
		);

		const pageTitle = screen.getByText( 'Example Site' );
		expect( pageTitle ).toBeVisible();

		fireEvent.mouseEnter( pageTitle );
		fireEvent.mouseMove( pageTitle, { movementX: 1, movementY: 1 } );

		expect( screen.queryByText( 'http://localhost:8881/wp-admin/' ) ).not.toBeInTheDocument();
		// Tooltips use Base UI's default open delay, so wait long enough for the popup to appear.
		expect(
			await screen.findByText( 'http://localhost:8881/wp-admin/', {}, { timeout: 2000 } )
		).toBeVisible();
	} );

	it( 'shows adjacent toolbar tooltips immediately while the delay group is active', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/wp-admin/" reloadNonce={ 0 } />
		);

		const pageTitle = screen.getByText( 'Example Site' );
		fireEvent.mouseEnter( pageTitle );
		fireEvent.mouseMove( pageTitle, { movementX: 1, movementY: 1 } );

		await screen.findByText( 'http://localhost:8881/wp-admin/', {}, { timeout: 2000 } );

		const refreshButton = screen.getByRole( 'button', { name: 'Refresh' } );
		expect( screen.queryByText( /^Refresh/ ) ).not.toBeInTheDocument();

		fireEvent.mouseLeave( pageTitle, { relatedTarget: refreshButton } );
		fireEvent.mouseEnter( refreshButton, { relatedTarget: pageTitle } );
		fireEvent.mouseMove( refreshButton, { movementX: 1, movementY: 1 } );

		const refreshTooltip = screen.getByText( /^Refresh/ );
		expect( refreshTooltip ).toBeInTheDocument();
		expect( refreshTooltip ).toHaveAttribute( 'data-instant', 'delay' );
	} );

	it( 'hides browser controls and shows the stopped preview treatment when the site is not running', async () => {
		const getSiteThumbnail = vi.fn().mockResolvedValue( 'data:image/png;base64,thumbnail' );
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			getSiteThumbnail,
			capabilities: CAPABILITIES,
		} as never );

		const { container } = renderPreview(
			<SitePreview site={ createSite() } path="/wp-admin/" reloadNonce={ 0 } />
		);

		expect( screen.queryByRole( 'button', { name: 'Refresh' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Annotate' } ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'http://localhost:8881/wp-admin/' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Start site' } ) ).toBeVisible();
		expect( container.querySelector( 'canvas' ) ).toBeInTheDocument();
		await waitFor( () => expect( getSiteThumbnail ).toHaveBeenCalledWith( 'site-1' ) );

		expect(
			await screen.findByRole( 'img', { name: 'Screenshot of Example Site' } )
		).toHaveAttribute( 'src', 'data:image/png;base64,thumbnail' );
	} );

	it( 'shows a refresh button that reloads the active preview surface', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		const { container } = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		const refreshButton = screen.getByRole( 'button', { name: 'Refresh' } );
		expect( refreshButton ).toBeEnabled();
		expect( refreshButton ).toHaveAttribute( 'aria-keyshortcuts', expect.stringMatching( /\+R$/ ) );

		const initialIframe = container.querySelector( 'iframe' );
		expect( initialIframe ).toBeInTheDocument();

		fireEvent.click( refreshButton );

		expect( container.querySelector( 'iframe' ) ).not.toBe( initialIframe );
	} );

	it( 'captures a full-page screenshot and forwards it to the composer callback', async () => {
		const restoreUserAgent = mockElectronUserAgent();
		const restoreWebviewContentsId = mockWebviewContentsId();
		const captureSiteScreenshot = vi.fn().mockResolvedValue( {
			name: 'screenshot-desktop.jpg',
			mimeType: 'image/jpeg',
			data: new Uint8Array( [ 1, 2, 3 ] ).buffer,
		} );
		const onScreenshotDone = vi.fn().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			capabilities: CAPABILITIES,
			startSite: vi.fn().mockResolvedValue( undefined ),
			captureSiteScreenshot,
		} as never );

		try {
			renderPreview(
				<SitePreview
					site={ createSite( { running: true } ) }
					path="/about/"
					reloadNonce={ 0 }
					onScreenshotDone={ onScreenshotDone }
				/>
			);

			await clickOverflowMenuItem( 'Add full-page screenshot to composer' );

			await waitFor( () => {
				expect( captureSiteScreenshot ).toHaveBeenCalledWith( 42, {
					colorScheme: 'light',
				} );
			} );
			await waitFor( () => expect( onScreenshotDone ).toHaveBeenCalledTimes( 1 ) );

			const [ file ] = onScreenshotDone.mock.calls[ 0 ];
			expect( file ).toBeInstanceOf( File );
			expect( file.name ).toBe( 'screenshot-desktop.jpg' );
			expect( file.type ).toBe( 'image/jpeg' );
			expect( file.size ).toBe( 3 );
		} finally {
			restoreWebviewContentsId();
			restoreUserAgent();
		}
	} );

	it( 'shows an error toast when the screenshot cannot be added', async () => {
		resetAppMessagesForTests();
		const restoreUserAgent = mockElectronUserAgent();
		const restoreWebviewContentsId = mockWebviewContentsId();
		const consoleError = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		useConnectorMock.mockReturnValue( {
			capabilities: CAPABILITIES,
			startSite: vi.fn().mockResolvedValue( undefined ),
			captureSiteScreenshot: vi.fn().mockRejectedValue( new Error( 'No IPC handler' ) ),
		} as never );

		try {
			renderPreview(
				<SitePreview
					site={ createSite( { running: true } ) }
					path="/about/"
					reloadNonce={ 0 }
					onScreenshotDone={ vi.fn().mockResolvedValue( undefined ) }
				/>
			);

			await clickOverflowMenuItem( 'Add full-page screenshot to composer' );

			await waitFor( () =>
				expect( getVisibleToasts().map( ( item ) => item.title ) ).toContain(
					'Screenshot could not be added.'
				)
			);
		} finally {
			restoreWebviewContentsId();
			restoreUserAgent();
			consoleError.mockRestore();
		}
	} );

	it( 'uses a switch to toggle the preview color scheme', () => {
		const restoreUserAgent = mockElectronUserAgent();
		useConnectorMock.mockReturnValue( {
			capabilities: CAPABILITIES,
			startSite: vi.fn().mockResolvedValue( undefined ),
		} as never );

		try {
			renderPreview(
				<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
			);

			const switchControl = screen.getByRole( 'switch', { name: 'Preview in dark mode' } );
			expect( switchControl ).not.toBeChecked();

			fireEvent.click( switchControl );

			expect( screen.getByRole( 'switch', { name: 'Preview in light mode' } ) ).toBeChecked();
		} finally {
			restoreUserAgent();
		}
	} );

	it( 'uses the preferred dark color scheme when capturing screenshots', async () => {
		const restoreMatchMedia = mockPrefersDarkColorScheme( true );
		const restoreUserAgent = mockElectronUserAgent();
		const restoreWebviewContentsId = mockWebviewContentsId();
		const captureSiteScreenshot = vi.fn().mockResolvedValue( {
			name: 'screenshot-desktop-dark.jpg',
			mimeType: 'image/jpeg',
			data: new Uint8Array( [ 1 ] ).buffer,
		} );
		useConnectorMock.mockReturnValue( {
			capabilities: CAPABILITIES,
			startSite: vi.fn().mockResolvedValue( undefined ),
			captureSiteScreenshot,
		} as never );

		try {
			renderPreview(
				<SitePreview
					site={ createSite( { running: true } ) }
					path="/"
					reloadNonce={ 0 }
					onScreenshotDone={ vi.fn().mockResolvedValue( undefined ) }
				/>
			);

			await clickOverflowMenuItem( 'Add full-page screenshot to composer' );

			await waitFor( () => {
				expect( captureSiteScreenshot ).toHaveBeenCalledWith( 42, {
					colorScheme: 'dark',
				} );
			} );
		} finally {
			restoreMatchMedia();
			restoreWebviewContentsId();
			restoreUserAgent();
		}
	} );

	it( 'shows webview console messages in the preview console drawer', async () => {
		const restoreUserAgent = mockElectronUserAgent();
		const onConsoleEntriesChange = vi.fn();
		useConnectorMock.mockReturnValue( {
			capabilities: CAPABILITIES,
			startSite: vi.fn().mockResolvedValue( undefined ),
			copyText: vi.fn().mockResolvedValue( undefined ),
		} as never );

		try {
			const { container } = renderPreview(
				<SitePreview
					site={ createSite( { running: true } ) }
					path="/"
					reloadNonce={ 0 }
					onConsoleEntriesChange={ onConsoleEntriesChange }
				/>
			);
			const webview = container.querySelector( 'webview' );
			expect( webview ).toBeInTheDocument();

			dispatchWebviewConsoleMessage( webview!, {
				level: 3,
				message: 'Uncaught TypeError: Cannot read properties of undefined',
				sourceId: 'http://localhost:8881/wp-content/themes/example/app.js',
				line: 27,
			} );

			await waitFor( () => {
				expect( onConsoleEntriesChange ).toHaveBeenLastCalledWith( [
					expect.objectContaining( {
						level: 'error',
						message: 'Uncaught TypeError: Cannot read properties of undefined',
						sourceId: 'http://localhost:8881/wp-content/themes/example/app.js',
						lineNumber: 27,
					} ),
				] );
			} );

			await clickOverflowMenuItem( 'Show console' );

			expect(
				screen.getByText( 'Uncaught TypeError: Cannot read properties of undefined' )
			).toBeVisible();
			expect( screen.getByText( 'app.js:27' ) ).toBeVisible();
		} finally {
			restoreUserAgent();
		}
	} );

	it( 'attaches visible console messages as a text file', async () => {
		const restoreUserAgent = mockElectronUserAgent();
		const onConsoleFileDone = vi.fn().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			capabilities: CAPABILITIES,
			startSite: vi.fn().mockResolvedValue( undefined ),
			copyText: vi.fn().mockResolvedValue( undefined ),
		} as never );

		try {
			const { container } = renderPreview(
				<SitePreview
					site={ createSite( { running: true } ) }
					path="/"
					reloadNonce={ 0 }
					onConsoleFileDone={ onConsoleFileDone }
				/>
			);
			const webview = container.querySelector( 'webview' );
			expect( webview ).toBeInTheDocument();

			dispatchWebviewConsoleMessage( webview!, {
				level: 3,
				message: 'Uncaught TypeError: Cannot read properties of undefined',
				sourceId: 'http://localhost:8881/wp-content/themes/example/app.js',
				line: 27,
			} );

			await clickOverflowMenuItem( 'Show console' );
			await act( async () => {
				fireEvent.click(
					screen.getByRole( 'button', { name: 'Attach visible console messages to composer' } )
				);
			} );

			await waitFor( () => expect( onConsoleFileDone ).toHaveBeenCalledTimes( 1 ) );
			const [ file ] = onConsoleFileDone.mock.calls[ 0 ];
			expect( file.name ).toMatch( /^browser-console-.*\.txt$/ );
			expect( file.mimeType ).toBe( 'text/plain' );
			expect( file.contents ).toContain(
				'Uncaught TypeError: Cannot read properties of undefined'
			);
			expect( file.size ).toBeGreaterThan( 0 );
		} finally {
			restoreUserAgent();
		}
	} );

	it( 'resizes the console drawer from the shared resize handle', async () => {
		const restoreUserAgent = mockElectronUserAgent();
		useConnectorMock.mockReturnValue( {
			capabilities: CAPABILITIES,
			startSite: vi.fn().mockResolvedValue( undefined ),
			copyText: vi.fn().mockResolvedValue( undefined ),
		} as never );

		try {
			const { container } = renderPreview(
				<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
			);
			const webview = container.querySelector( 'webview' );
			expect( webview ).toBeInTheDocument();

			dispatchWebviewConsoleMessage( webview!, {
				message: 'Console output',
			} );
			await clickOverflowMenuItem( 'Show console' );

			const resizeHandle = screen.getByRole( 'separator', { name: 'Resize console' } );
			expect( resizeHandle ).toHaveAttribute( 'aria-valuenow', '280' );
			expect( resizeHandle ).toHaveAttribute( 'aria-orientation', 'horizontal' );

			fireEvent.keyDown( resizeHandle, { key: 'ArrowUp' } );

			await waitFor( () => expect( resizeHandle ).toHaveAttribute( 'aria-valuenow', '304' ) );

			fireEvent.mouseDown( resizeHandle, { button: 0, clientY: 500 } );
			expect( document.body ).toHaveStyle( { cursor: 'row-resize' } );
			fireEvent.mouseUp( document, { clientY: 420 } );

			await waitFor( () => expect( resizeHandle ).toHaveAttribute( 'aria-valuenow', '384' ) );
			expect( document.body ).not.toHaveStyle( { cursor: 'row-resize' } );
		} finally {
			restoreUserAgent();
		}
	} );

	it( 'does not show internal inspector bridge messages in the preview console', async () => {
		const restoreUserAgent = mockElectronUserAgent();
		const onConsoleEntriesChange = vi.fn();
		useConnectorMock.mockReturnValue( {
			capabilities: CAPABILITIES,
			startSite: vi.fn().mockResolvedValue( undefined ),
			copyText: vi.fn().mockResolvedValue( undefined ),
		} as never );

		try {
			const { container } = renderPreview(
				<SitePreview
					site={ createSite( { running: true } ) }
					path="/"
					reloadNonce={ 0 }
					onConsoleEntriesChange={ onConsoleEntriesChange }
				/>
			);
			const webview = container.querySelector( 'webview' );
			expect( webview ).toBeInTheDocument();

			dispatchWebviewConsoleMessage( webview!, {
				message: `${ INSPECTOR_BRIDGE_PREFIX }${ JSON.stringify( {
					type: 'state',
					isPicking: false,
					annotationCount: 0,
				} ) }`,
			} );

			await clickOverflowMenuItem( 'Show console' );

			expect( screen.getByText( 'No console messages yet.' ) ).toBeVisible();
			expect( onConsoleEntriesChange ).toHaveBeenLastCalledWith( [] );
		} finally {
			restoreUserAgent();
		}
	} );

	it( 'reloads the preview on the primary-modifier+R shortcut', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
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

		// Extra modifiers must not trigger the shortcut.
		const reloadedIframe = container.querySelector( 'iframe' );
		fireEvent.keyDown( document.body, { key: 'r', ctrlKey: true, shiftKey: true } );
		expect( container.querySelector( 'iframe' ) ).toBe( reloadedIframe );
	} );

	it( 'hides the Annotate control when the host cannot annotate the preview', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		// The toolbar is present (Refresh shows) but Annotate is omitted entirely.
		expect( screen.getByRole( 'button', { name: 'Refresh' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Annotate' } ) ).not.toBeInTheDocument();
	} );

	it( 'shows the Annotate control when the host supports preview annotation', () => {
		useConnectorMock.mockReturnValue( {
			capabilities: CAPABILITIES,
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: { ...CAPABILITIES, annotatePreview: true },
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeInTheDocument();
	} );
} );

describe( 'getToolbarPageTitle', () => {
	it( 'strips the WordPress admin suffix from document titles', () => {
		expect( getToolbarPageTitle( 'Dashboard ‹ Example Site — WordPress', 'Example Site' ) ).toBe(
			'Dashboard'
		);
		expect( getToolbarPageTitle( 'Posts ‹ My Blog — WordPress', 'My Blog' ) ).toBe( 'Posts' );
	} );

	it( 'returns front-end titles unchanged', () => {
		expect( getToolbarPageTitle( 'Example Site – Just another WordPress site', 'Example' ) ).toBe(
			'Example Site – Just another WordPress site'
		);
	} );

	it( 'falls back to the site name, then a generic label', () => {
		expect( getToolbarPageTitle( null, 'Example Site' ) ).toBe( 'Example Site' );
		expect( getToolbarPageTitle( '   ', 'Example Site' ) ).toBe( 'Example Site' );
		expect( getToolbarPageTitle( null, '' ) ).toBe( 'Site preview' );
	} );
} );

describe( 'getSimulatedViewport', () => {
	it( 'returns null without a requested width or a measured pane', () => {
		expect( getSimulatedViewport( null, { width: 520, height: 700 } ) ).toBe( null );
		expect( getSimulatedViewport( 390, null ) ).toBe( null );
		expect( getSimulatedViewport( 390, { width: 0, height: 700 } ) ).toBe( null );
	} );

	it( 'renders widths narrower than the pane 1:1', () => {
		expect( getSimulatedViewport( 390, { width: 520, height: 700 } ) ).toEqual( {
			width: 390,
			height: 700,
			scale: 1,
		} );
	} );

	it( 'scales widths wider than the pane down to fit, extending the emulated height', () => {
		const viewport = getSimulatedViewport( 1440, { width: 480, height: 600 } );
		expect( viewport?.width ).toBe( 1440 );
		expect( viewport?.scale ).toBeCloseTo( 480 / 1440 );
		// The scaled page still fills the pane vertically: height × scale ≈ pane height.
		expect( ( viewport?.height ?? 0 ) * ( viewport?.scale ?? 0 ) ).toBeCloseTo( 600, 0 );
	} );

	it( 'matches the pane exactly at equal widths', () => {
		expect( getSimulatedViewport( 520, { width: 520, height: 700 } ) ).toEqual( {
			width: 520,
			height: 700,
			scale: 1,
		} );
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
