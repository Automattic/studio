import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { displayShortcut } from '@wordpress/keycodes';
import { Tooltip } from '@wordpress/ui';
import { describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import {
	getBrowserShortcutCommand,
	getPathFromPreviewUrl,
	getSimulatedViewport,
	SitePreview,
} from './index';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

// jsdom has no 2D canvas context, so swap the animated grid for a bare canvas.
vi.mock( '@/components/dot-grid', () => ( {
	DotGrid: () => <canvas data-testid="dot-grid" />,
} ) );

vi.mock( '@/hooks/use-traffic-light-space', () => ( {
	useTrafficLightSpace: () => ( { start: false, end: false } ),
} ) );

const useConnectorMock = vi.mocked( useConnector );

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

describe( 'SitePreview', () => {
	it( 'shows the active realm name with the same tooltip as when inactive', async () => {
		useConnectorMock.mockReturnValue( {
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

		expect( screen.queryByRole( 'button', { name: 'Refresh' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Annotate' } ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'WordPress' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Start site' } ) ).toBeVisible();
		expect( container.querySelector( 'canvas' ) ).toBeInTheDocument();
		await waitFor( () => expect( getSiteThumbnail ).toHaveBeenCalledWith( 'site-1' ) );

		expect(
			await screen.findByRole( 'img', { name: 'Screenshot of Example Site' } )
		).toHaveAttribute( 'src', 'data:image/png;base64,thumbnail' );
	} );

	it( 'keeps the Open in… control in the toolbar while the site is stopped', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview( <SitePreview site={ createSite() } path="/" reloadNonce={ 0 } /> );

		expect( screen.getByRole( 'button', { name: 'Open in…' } ) ).toBeVisible();
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

	it( 'switches realms on primary-modifier number shortcuts', () => {
		useConnectorMock.mockReturnValue( {
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

		// Re-selecting the already-active realm is a no-op.
		onPathChange.mockClear();
		fireEvent.keyDown( document.body, { key: '1', ctrlKey: true } );
		expect( onPathChange ).not.toHaveBeenCalled();
	} );

	it( 'switches to the database realm on its shortcut', () => {
		useConnectorMock.mockReturnValue( {
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

		fireEvent.keyDown( document.body, { key: '3', ctrlKey: true } );
		expect( onPathChange ).toHaveBeenCalledWith(
			'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
		);
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
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: { ...CAPABILITIES, annotatePreview: true },
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeInTheDocument();
	} );

	it( 'offers responsive modes from the More options menu while running', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'More options' } ) );

		expect( await screen.findByText( 'Responsive mode' ) ).toBeVisible();
		expect( screen.getByRole( 'menuitemradio', { name: 'Fit pane' } ) ).toBeChecked();
		// The orientation group only accompanies the phone frame.
		expect( screen.queryByText( 'Mobile orientation' ) ).not.toBeInTheDocument();

		// Radio items keep the menu open, so the orientation group appears in place.
		fireEvent.click( screen.getByRole( 'menuitemradio', { name: 'Mobile · 390×844' } ) );

		expect( await screen.findByText( 'Mobile orientation' ) ).toBeVisible();
		expect( screen.getByRole( 'menuitemradio', { name: 'Portrait' } ) ).toBeChecked();

		// The menu is modal: its backdrop covers the webview, so clicks over
		// the preview dismiss the menu instead of vanishing into the guest.
		const backdrop = document.querySelector( '[role="presentation"][data-base-ui-inert]' );
		expect( backdrop ).toBeInTheDocument();
		fireEvent.pointerDown( backdrop as Element );
		await waitFor( () =>
			expect( screen.queryByText( 'Responsive mode' ) ).not.toBeInTheDocument()
		);
	} );

	it( 'hides the More options menu when the site is not running', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview( <SitePreview site={ createSite() } path="/" reloadNonce={ 0 } /> );

		expect( screen.queryByRole( 'button', { name: 'More options' } ) ).not.toBeInTheDocument();
	} );

	it( 'remembers the responsive mode per site during the session', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		const ui = ( site: SiteDetails ) => (
			<QueryClientProvider client={ queryClient }>
				<Tooltip.Provider>
					<SitePreview site={ site } path="/" reloadNonce={ 0 } />
				</Tooltip.Provider>
			</QueryClientProvider>
		);
		const siteA = createSite( { id: 'site-a', running: true } );
		const siteB = createSite( { id: 'site-b', running: true } );

		const { rerender } = render( ui( siteA ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'More options' } ) );
		fireEvent.click( await screen.findByRole( 'menuitemradio', { name: 'Mobile · 390×844' } ) );

		// A site without a remembered mode starts from the default…
		rerender( ui( siteB ) );
		expect( await screen.findByRole( 'menuitemradio', { name: 'Fit pane' } ) ).toBeChecked();

		// …and returning to the first site restores its mode.
		rerender( ui( siteA ) );
		expect(
			await screen.findByRole( 'menuitemradio', { name: 'Mobile · 390×844' } )
		).toBeChecked();
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

describe( 'getSimulatedViewport', () => {
	it( 'returns null without a preset or a measured pane', () => {
		expect( getSimulatedViewport( null, { width: 520, height: 700 } ) ).toBe( null );
		expect( getSimulatedViewport( { width: 390, height: 844 }, null ) ).toBe( null );
		expect( getSimulatedViewport( { width: 390, height: 844 }, { width: 0, height: 700 } ) ).toBe(
			null
		);
	} );

	it( 'keeps presets at their exact dimensions, scaled down to fit both axes', () => {
		// The height binds: 700 / 844 is smaller than 520 / 390.
		expect(
			getSimulatedViewport( { width: 390, height: 844, mobile: true }, { width: 520, height: 700 } )
		).toEqual( {
			width: 390,
			height: 844,
			scale: 700 / 844,
			mobile: true,
		} );
		// The width binds for a desktop frame in a narrow pane.
		expect(
			getSimulatedViewport( { width: 1440, height: 900 }, { width: 720, height: 800 } )
		).toEqual( {
			width: 1440,
			height: 900,
			scale: 0.5,
			mobile: false,
		} );
	} );

	it( 'never scales up in a larger pane', () => {
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
