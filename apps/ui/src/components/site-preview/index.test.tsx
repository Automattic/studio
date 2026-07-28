import { INSPECTOR_BRIDGE_PREFIX } from '@studio/common/inspector/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { displayShortcut } from '@wordpress/keycodes';
import { Tooltip } from '@wordpress/ui';
import { describe, expect, it, vi } from 'vitest';
import { getVisibleToasts, resetAppMessagesForTests } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { getPathFromPreviewUrl, getSimulatedViewport, SitePreview } from './index';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

// The Open in… split button brings router and data hooks along; its behavior
// is covered by its own tests.
vi.mock( '@/components/open-in-menu', () => ( {
	OpenInMenu: () => <button type="button">Open in…</button>,
} ) );

const useConnectorMock = vi.mocked( useConnector );

// Connector methods every render needs (the traffic-light hook subscribes
// to fullscreen state); merged under each test's specific mocks.
function baseConnector() {
	return {
		reservesTrafficLightSpace: false,
		isFullscreen: vi.fn().mockResolvedValue( false ),
		onFullscreenChange: vi.fn( () => () => {} ),
	};
}

// Browser-style capabilities (no native dialogs, no preview annotation) — the
// component reads `connector.capabilities` to decide which toolbar controls show.
const CAPABILITIES = {
	nativeFolderPicker: false,
	nativeSaveDialog: false,
	openInOS: false,
	annotatePreview: false,
	readLocalMedia: false,
};

function renderPreview( children: ReactNode ) {
	const queryClient = new QueryClient( {
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	} );
	const wrap = ( node: ReactNode ) => (
		<QueryClientProvider client={ queryClient }>
			<Tooltip.Provider>{ node }</Tooltip.Provider>
		</QueryClientProvider>
	);
	const result = render( wrap( children ) );
	return {
		...result,
		rerender: ( node: ReactNode ) => result.rerender( wrap( node ) ),
	};
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

// Console and the preview environment controls live in the trailing "•••" menu.
async function clickOverflowMenuItem( name: string | RegExp ) {
	fireEvent.click( screen.getByRole( 'button', { name: 'More options' } ) );
	fireEvent.click( await screen.findByRole( 'menuitem', { name } ) );
}

// The clip kinds live in the Clip split button's dropdown.
async function clickClipMenuItem( name: string ) {
	fireEvent.click( screen.getByRole( 'button', { name: 'Clip…' } ) );
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
	it( 'shows the active realm name with the same tooltip as when inactive', async () => {
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/wp-admin/" reloadNonce={ 0 } />
		);

		// The active segment wears the realm name ("WordPress" for /wp-admin/).
		const realmTitle = screen.getByText( 'WordPress' );
		expect( realmTitle ).toBeVisible();

		// The title is a span inside the address trigger; tooltip hover events
		// don't bubble, so target the button itself.
		const addressTrigger = realmTitle.closest( 'button' ) as HTMLElement;
		fireEvent.mouseEnter( addressTrigger );
		fireEvent.mouseMove( addressTrigger, { movementX: 1, movementY: 1 } );

		// jsdom reports a non-Apple platform, so the shortcut renders as Ctrl+2.
		const tooltip = `View WP Admin ${ displayShortcut.primary( '2' ) }`;
		expect( screen.queryByText( tooltip ) ).not.toBeInTheDocument();
		// Tooltips use Base UI's default open delay, so wait long enough for the popup to appear.
		expect( await screen.findByText( tooltip, {}, { timeout: 2000 } ) ).toBeVisible();
	} );

	it( 'shows adjacent toolbar tooltips immediately while the delay group is active', async () => {
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/wp-admin/" reloadNonce={ 0 } />
		);

		const addressTrigger = screen.getByText( 'WordPress' ).closest( 'button' ) as HTMLElement;
		fireEvent.mouseEnter( addressTrigger );
		fireEvent.mouseMove( addressTrigger, { movementX: 1, movementY: 1 } );

		await screen.findByText(
			`View WP Admin ${ displayShortcut.primary( '2' ) }`,
			{},
			{ timeout: 2000 }
		);

		const refreshButton = screen.getByRole( 'button', { name: 'Refresh' } );
		expect( screen.queryByText( /^Refresh/ ) ).not.toBeInTheDocument();

		fireEvent.mouseLeave( addressTrigger, { relatedTarget: refreshButton } );
		fireEvent.mouseEnter( refreshButton, { relatedTarget: addressTrigger } );
		fireEvent.mouseMove( refreshButton, { movementX: 1, movementY: 1 } );

		const refreshTooltip = screen.getByText( /^Refresh/ );
		expect( refreshTooltip ).toBeInTheDocument();
		expect( refreshTooltip ).toHaveAttribute( 'data-instant', 'delay' );
	} );

	it( 'hides browser controls and shows the stopped preview treatment when the site is not running', async () => {
		const getSiteThumbnail = vi.fn().mockResolvedValue( 'data:image/png;base64,thumbnail' );
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			startSite: vi.fn().mockResolvedValue( undefined ),
			getSiteThumbnail,
			capabilities: CAPABILITIES,
		} as never );

		const { container } = renderPreview(
			<SitePreview site={ createSite() } path="/wp-admin/" reloadNonce={ 0 } />
		);

		expect( screen.queryByRole( 'button', { name: 'Refresh' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: /^Clip/ } ) ).not.toBeInTheDocument();
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
			...baseConnector(),
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		const { container } = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		const refreshButton = screen.getByRole( 'button', { name: 'Refresh' } );
		expect( refreshButton ).toBeEnabled();
		expect( refreshButton ).toHaveAttribute( 'aria-keyshortcuts', expect.stringMatching( /\+R$/ ) );

		// jsdom reports a non-Apple platform: the navigation alias is Alt+arrow,
		// with the bracket chord kept as a secondary shortcut.
		expect( screen.getByRole( 'button', { name: 'Back' } ) ).toHaveAttribute(
			'aria-keyshortcuts',
			'Alt+ArrowLeft Control+['
		);
		expect( screen.getByRole( 'button', { name: 'Forward' } ) ).toHaveAttribute(
			'aria-keyshortcuts',
			'Alt+ArrowRight Control+]'
		);

		const initialIframe = container.querySelector( 'iframe' );
		expect( initialIframe ).toBeInTheDocument();

		fireEvent.click( refreshButton );

		expect( container.querySelector( 'iframe' ) ).not.toBe( initialIframe );
	} );

	it( 'captures a page clip and forwards it to the clip callback', async () => {
		const restoreUserAgent = mockElectronUserAgent();
		const restoreWebviewContentsId = mockWebviewContentsId();
		const captureFullPageScreenshot = vi.fn().mockResolvedValue( {
			name: 'clip-page.jpg',
			mimeType: 'image/jpeg',
			data: new Uint8Array( [ 1, 2, 3 ] ).buffer,
		} );
		const onClip = vi.fn().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			capabilities: { ...CAPABILITIES, annotatePreview: true },
			startSite: vi.fn().mockResolvedValue( undefined ),
			captureFullPageScreenshot,
		} as never );

		try {
			renderPreview(
				<SitePreview
					site={ createSite( { running: true } ) }
					path="/about/"
					reloadNonce={ 0 }
					onClip={ onClip }
				/>
			);

			await clickClipMenuItem( 'Clip the page' );

			await waitFor( () => {
				expect( captureFullPageScreenshot ).toHaveBeenCalledWith(
					'http://localhost:8881/about/',
					expect.objectContaining( { colorScheme: 'light' } )
				);
			} );
			await waitFor( () => expect( onClip ).toHaveBeenCalledTimes( 1 ) );

			const [ input ] = onClip.mock.calls[ 0 ];
			expect( input.grain ).toBe( 'page' );
			expect( input.image ).toBeInstanceOf( File );
			expect( input.image.name ).toBe( 'clip-page.jpg' );
			expect( input.image.type ).toBe( 'image/jpeg' );
			expect( input.image.size ).toBe( 3 );
			expect( input.context ).toMatchObject( { realm: 'frontend', colorScheme: 'light' } );
		} finally {
			restoreWebviewContentsId();
			restoreUserAgent();
		}
	} );

	it( 'does not replay a stale page-clip request when switching sites', async () => {
		const restoreUserAgent = mockElectronUserAgent();
		const restoreWebviewContentsId = mockWebviewContentsId();
		const captureFullPageScreenshot = vi.fn().mockResolvedValue( {
			name: 'clip-page.jpg',
			mimeType: 'image/jpeg',
			data: new Uint8Array( [ 1 ] ).buffer,
		} );
		const onClip = vi.fn().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			capabilities: { ...CAPABILITIES, annotatePreview: true },
			startSite: vi.fn().mockResolvedValue( undefined ),
			captureFullPageScreenshot,
		} as never );

		try {
			const { rerender } = renderPreview(
				<SitePreview
					site={ createSite( { running: true } ) }
					path="/"
					reloadNonce={ 0 }
					onClip={ onClip }
				/>
			);

			await clickClipMenuItem( 'Clip the page' );
			await waitFor( () => expect( captureFullPageScreenshot ).toHaveBeenCalledTimes( 1 ) );

			// Switching sites remounts the webview surface while the request
			// state lives on in SitePreview; the fresh surface must not treat
			// the old request as new (regression: every site switch fired a
			// ghost page clip).
			rerender(
				<SitePreview
					site={ createSite( { id: 'site-2', name: 'Other Site', running: true } ) }
					path="/"
					reloadNonce={ 0 }
					onClip={ onClip }
				/>
			);
			await act( async () => {
				await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
			} );

			expect( captureFullPageScreenshot ).toHaveBeenCalledTimes( 1 );
		} finally {
			restoreWebviewContentsId();
			restoreUserAgent();
		}
	} );

	it( 'shows an error toast when the page clip cannot be added', async () => {
		resetAppMessagesForTests();
		const restoreUserAgent = mockElectronUserAgent();
		const restoreWebviewContentsId = mockWebviewContentsId();
		const consoleError = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			capabilities: { ...CAPABILITIES, annotatePreview: true },
			startSite: vi.fn().mockResolvedValue( undefined ),
			captureFullPageScreenshot: vi.fn().mockRejectedValue( new Error( 'No IPC handler' ) ),
		} as never );

		try {
			renderPreview(
				<SitePreview
					site={ createSite( { running: true } ) }
					path="/about/"
					reloadNonce={ 0 }
					onClip={ vi.fn().mockResolvedValue( undefined ) }
				/>
			);

			await clickClipMenuItem( 'Clip the page' );

			await waitFor( () =>
				expect( getVisibleToasts().map( ( item ) => item.title ) ).toContain(
					'Clip could not be added.'
				)
			);
		} finally {
			restoreWebviewContentsId();
			restoreUserAgent();
			consoleError.mockRestore();
		}
	} );

	it( 'switches the preview color scheme from the Appearance section', async () => {
		const restoreUserAgent = mockElectronUserAgent();
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			capabilities: CAPABILITIES,
			startSite: vi.fn().mockResolvedValue( undefined ),
		} as never );

		try {
			renderPreview(
				<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
			);

			fireEvent.click( screen.getByRole( 'button', { name: 'More options' } ) );
			// The item names include the toggle shortcut hint on the inactive
			// scheme, so match on the leading label.
			const darkOption = await screen.findByRole( 'menuitemradio', { name: /^Dark/ } );
			expect( screen.getByRole( 'menuitemradio', { name: /^Light/ } ) ).toBeChecked();

			fireEvent.click( darkOption );

			// Radio items keep the menu open, so the switch is observable in place.
			await waitFor( () =>
				expect( screen.getByRole( 'menuitemradio', { name: /^Dark/ } ) ).toBeChecked()
			);
		} finally {
			restoreUserAgent();
		}
	} );

	it( 'toggles the preview color scheme on the primary-shift+D shortcut', async () => {
		const restoreUserAgent = mockElectronUserAgent();
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			capabilities: CAPABILITIES,
			startSite: vi.fn().mockResolvedValue( undefined ),
		} as never );

		try {
			renderPreview(
				<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
			);

			// jsdom reports a non-Apple platform, so the modifier pair is Ctrl+Shift.
			fireEvent.keyDown( document.body, { key: 'd', ctrlKey: true, shiftKey: true } );

			fireEvent.click( screen.getByRole( 'button', { name: 'More options' } ) );
			expect( await screen.findByRole( 'menuitemradio', { name: /^Dark/ } ) ).toBeChecked();
		} finally {
			restoreUserAgent();
		}
	} );

	it( 'uses the preferred dark color scheme when capturing page clips', async () => {
		const restoreMatchMedia = mockPrefersDarkColorScheme( true );
		const restoreUserAgent = mockElectronUserAgent();
		const restoreWebviewContentsId = mockWebviewContentsId();
		const captureFullPageScreenshot = vi.fn().mockResolvedValue( {
			name: 'clip-page-dark.jpg',
			mimeType: 'image/jpeg',
			data: new Uint8Array( [ 1 ] ).buffer,
		} );
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			capabilities: { ...CAPABILITIES, annotatePreview: true },
			startSite: vi.fn().mockResolvedValue( undefined ),
			captureFullPageScreenshot,
		} as never );

		try {
			renderPreview(
				<SitePreview
					site={ createSite( { running: true } ) }
					path="/"
					reloadNonce={ 0 }
					onClip={ vi.fn().mockResolvedValue( undefined ) }
				/>
			);

			await clickClipMenuItem( 'Clip the page' );

			await waitFor( () => {
				expect( captureFullPageScreenshot ).toHaveBeenCalledWith(
					expect.any( String ),
					expect.objectContaining( { colorScheme: 'dark' } )
				);
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
			...baseConnector(),
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

	it( 'attaches visible console messages as a console clip', async () => {
		const restoreUserAgent = mockElectronUserAgent();
		const onClip = vi.fn().mockResolvedValue( undefined );
		const createTemporaryTextFile = vi.fn().mockResolvedValue( '/tmp/browser-console.txt' );
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			capabilities: CAPABILITIES,
			startSite: vi.fn().mockResolvedValue( undefined ),
			copyText: vi.fn().mockResolvedValue( undefined ),
			createTemporaryTextFile,
		} as never );

		try {
			const { container } = renderPreview(
				<SitePreview
					site={ createSite( { running: true } ) }
					path="/"
					reloadNonce={ 0 }
					onClip={ onClip }
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

			await waitFor( () => expect( onClip ).toHaveBeenCalledTimes( 1 ) );
			const [ fileName, contents ] = createTemporaryTextFile.mock.calls[ 0 ];
			expect( fileName ).toMatch( /^browser-console-.*\.txt$/ );
			expect( contents ).toContain( 'Uncaught TypeError: Cannot read properties of undefined' );
			const [ input ] = onClip.mock.calls[ 0 ];
			expect( input.grain ).toBe( 'console' );
			expect( input.filePath ).toBe( '/tmp/browser-console.txt' );
			expect( input.entryCount ).toBe( 1 );
			expect( input.fileSize ).toBeGreaterThan( 0 );
		} finally {
			restoreUserAgent();
		}
	} );

	it( 'resizes the console drawer from the shared resize handle', async () => {
		const restoreUserAgent = mockElectronUserAgent();
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
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
			...baseConnector(),
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
			...baseConnector(),
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

	it( 'switches realms on primary-modifier number shortcuts', () => {
		window.localStorage.setItem( 'studio:preview-show-database-tab', 'true' );
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			startSite: vi.fn().mockResolvedValue( undefined ),
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

		// jsdom reports a non-Apple platform, so the primary modifier is Ctrl.
		fireEvent.keyDown( document.body, { key: '2', ctrlKey: true } );
		expect( onPathChange ).toHaveBeenCalledWith(
			`/studio-auto-login?redirect_to=${ encodeURIComponent( 'http://localhost:8881/wp-admin/' ) }`
		);

		fireEvent.keyDown( document.body, { key: '3', ctrlKey: true } );
		expect( onPathChange ).toHaveBeenCalledWith(
			'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
		);

		// Re-selecting the already-active realm is a no-op.
		onPathChange.mockClear();
		fireEvent.keyDown( document.body, { key: '1', ctrlKey: true } );
		expect( onPathChange ).not.toHaveBeenCalled();
		window.localStorage.removeItem( 'studio:preview-show-database-tab' );
	} );

	it( 'hides the Clip split button when the host cannot annotate the preview', () => {
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview
				site={ createSite( { running: true } ) }
				path="/"
				reloadNonce={ 0 }
				onClip={ vi.fn() }
			/>
		);

		// The toolbar is present (Refresh shows) but Clip is omitted entirely.
		expect( screen.getByRole( 'button', { name: 'Refresh' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: /^Clip/ } ) ).not.toBeInTheDocument();
	} );

	it( 'shows the Clip split button when the host supports preview annotation', async () => {
		const restoreUserAgent = mockElectronUserAgent();
		// The trigger reflects the last-used action; other tests in this file
		// may have stored one.
		window.localStorage.clear();
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: { ...CAPABILITIES, annotatePreview: true },
		} as never );

		try {
			renderPreview(
				<SitePreview
					site={ createSite( { running: true } ) }
					path="/"
					reloadNonce={ 0 }
					onClip={ vi.fn() }
				/>
			);

			// The main action defaults to the element grain; the chevron opens
			// the other clip kinds.
			expect( screen.getByRole( 'button', { name: 'Clip an element' } ) ).toBeInTheDocument();
			fireEvent.click( screen.getByRole( 'button', { name: 'Clip…' } ) );
			expect( await screen.findByRole( 'menuitem', { name: 'Clip a region' } ) ).toBeVisible();
			expect( screen.getByRole( 'menuitem', { name: 'Clip a detail' } ) ).toBeVisible();
			expect( screen.getByRole( 'menuitem', { name: 'Clip the page' } ) ).toBeVisible();
		} finally {
			restoreUserAgent();
		}
	} );

	it( 'omits the full preview toggle unless the host provides one', async () => {
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'More options' } ) );
		// Wait for the menu to open before asserting the item's absence.
		await screen.findByRole( 'menuitem', { name: 'Show console' } );
		expect( screen.queryByRole( 'menuitem', { name: /^Full preview/ } ) ).not.toBeInTheDocument();
	} );

	it( 'toggles full preview from the overflow menu', async () => {
		const onToggleFullscreen = vi.fn();
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		const { rerender } = renderPreview(
			<SitePreview
				site={ createSite( { running: true } ) }
				path="/"
				reloadNonce={ 0 }
				onToggleFullscreen={ onToggleFullscreen }
			/>
		);

		await clickOverflowMenuItem( /^Full preview/ );
		expect( onToggleFullscreen ).toHaveBeenCalledTimes( 1 );

		rerender(
			<SitePreview
				site={ createSite( { running: true } ) }
				path="/"
				reloadNonce={ 0 }
				fullscreen
				onToggleFullscreen={ onToggleFullscreen }
			/>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'More options' } ) );
		expect( await screen.findByRole( 'menuitem', { name: /^Exit full preview/ } ) ).toBeVisible();
	} );

	it( 'toggles full preview on the primary-shift+F shortcut', () => {
		const onToggleFullscreen = vi.fn();
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview
				site={ createSite( { running: true } ) }
				path="/"
				reloadNonce={ 0 }
				onToggleFullscreen={ onToggleFullscreen }
			/>
		);

		// jsdom reports a non-Apple platform, so the modifier pair is Ctrl+Shift.
		fireEvent.keyDown( document.body, { key: 'f', ctrlKey: true, shiftKey: true } );
		expect( onToggleFullscreen ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'ignores the full preview shortcut when the host provides no toggle', () => {
		useConnectorMock.mockReturnValue( {
			...baseConnector(),
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		const keydown = fireEvent.keyDown( document.body, {
			key: 'f',
			ctrlKey: true,
			shiftKey: true,
		} );
		// Nothing claimed the keystroke, so default handling continues.
		expect( keydown ).toBe( true );
	} );
} );

describe( 'getSimulatedViewport', () => {
	it( 'returns null without a preset or a measured pane', () => {
		expect( getSimulatedViewport( null, { width: 520, height: 700 } ) ).toBe( null );
		expect( getSimulatedViewport( { width: 390 }, null ) ).toBe( null );
		expect( getSimulatedViewport( { width: 390 }, { width: 0, height: 700 } ) ).toBe( null );
	} );

	it( 'renders widths narrower than the pane 1:1', () => {
		expect( getSimulatedViewport( { width: 390 }, { width: 520, height: 700 } ) ).toEqual( {
			width: 390,
			height: 700,
			scale: 1,
			mobile: false,
		} );
	} );

	it( 'scales widths wider than the pane down to fit, extending the emulated height', () => {
		const viewport = getSimulatedViewport( { width: 1440 }, { width: 480, height: 600 } );
		expect( viewport?.width ).toBe( 1440 );
		expect( viewport?.scale ).toBeCloseTo( 480 / 1440 );
		// The scaled page still fills the pane vertically: height × scale ≈ pane height.
		expect( ( viewport?.height ?? 0 ) * ( viewport?.scale ?? 0 ) ).toBeCloseTo( 600, 0 );
	} );

	it( 'matches the pane exactly at equal widths', () => {
		expect( getSimulatedViewport( { width: 520 }, { width: 520, height: 700 } ) ).toEqual( {
			width: 520,
			height: 700,
			scale: 1,
			mobile: false,
		} );
	} );

	it( 'keeps fixed-height presets at their exact dimensions, scaled to fit both axes', () => {
		const viewport = getSimulatedViewport(
			{ width: 390, height: 844, mobile: true },
			{ width: 520, height: 700 }
		);
		// The height binds: 700 / 844 is smaller than 520 / 390.
		expect( viewport ).toEqual( {
			width: 390,
			height: 844,
			scale: 700 / 844,
			mobile: true,
		} );
	} );

	it( 'never scales fixed-height presets up in a larger pane', () => {
		expect(
			getSimulatedViewport( { width: 390, height: 844 }, { width: 600, height: 1000 } )
		).toEqual( {
			width: 390,
			height: 844,
			scale: 1,
			mobile: false,
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
