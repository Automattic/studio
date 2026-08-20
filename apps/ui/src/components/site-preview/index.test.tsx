import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { displayShortcut } from '@wordpress/keycodes';
import { Tooltip } from '@wordpress/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { themeDetailsQueryKey } from '@/hooks/use-theme-details';
import {
	getBrowserShortcutCommand,
	isOffOriginRedirect,
	isThemeActivationUrl,
	getPathFromPreviewUrl,
	getSimulatedViewport,
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
		reason: null,
		isReady: true,
	} ) ),
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
	const renderResult = render(
		<QueryClientProvider client={ queryClient }>
			<Tooltip.Provider>{ children }</Tooltip.Provider>
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
	it( 'recognizes WordPress theme activation navigations', () => {
		expect(
			isThemeActivationUrl( 'http://localhost:8881/wp-admin/themes.php?activated=true' )
		).toBe( true );
		expect(
			isThemeActivationUrl(
				'http://localhost:8881/wp-admin/themes.php?action=activate&stylesheet=twentythirteen'
			)
		).toBe( false );
		expect( isThemeActivationUrl( 'http://localhost:8881/wp-admin/themes.php' ) ).toBe( false );
		expect( isThemeActivationUrl( 'not a URL' ) ).toBe( false );
	} );

	it( 'refreshes theme details after activation inside the preview', async () => {
		const themeDetails = {
			name: 'Twenty Thirteen',
			path: '/wp-content/themes/twentythirteen',
			slug: 'twentythirteen',
			isBlockTheme: false,
		};
		const getThemeDetails = vi.fn().mockResolvedValue( themeDetails );
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			getThemeDetails,
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		const { container, queryClient } = renderPreview(
			<SitePreview
				site={ createSite( { running: true } ) }
				path="/wp-admin/themes.php?activated=true"
				reloadNonce={ 0 }
			/>
		);

		fireEvent.load( container.querySelector( 'iframe' )! );

		await waitFor( () => expect( getThemeDetails ).toHaveBeenCalledWith( 'site-1' ) );
		expect( queryClient.getQueryData( themeDetailsQueryKey( 'site-1' ) ) ).toEqual( themeDetails );
	} );

	it( 'shows the active realm name with the same tooltip as when inactive', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
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
			trackEvent: vi.fn().mockResolvedValue( undefined ),
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
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview( <SitePreview site={ createSite() } path="/" reloadNonce={ 0 } /> );

		expect( screen.getByRole( 'button', { name: 'Open in…' } ) ).toBeVisible();
	} );

	it( 'shows a refresh button that reloads the active preview surface', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
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

	it( 'switches realms on primary-modifier number shortcuts', () => {
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

	it( 'records an internal-browser Tracks event when switching realms', () => {
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

		fireEvent.keyDown( document.body, { key: '2', ctrlKey: true } );
		expect( trackEvent ).toHaveBeenCalledWith( 'studio_site_open_wp_admin', {
			browser: 'internal',
		} );
	} );

	it( 'does not record a realm switch when re-selecting the active realm', () => {
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

		// Already on the admin realm; its shortcut is a no-op.
		fireEvent.keyDown( document.body, { key: '2', ctrlKey: true } );
		expect( trackEvent ).not.toHaveBeenCalled();
	} );

	it( 'switches to the database realm on its shortcut', () => {
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

		fireEvent.keyDown( document.body, { key: '3', ctrlKey: true } );
		expect( onPathChange ).toHaveBeenCalledWith(
			'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
		);
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

	it( 'shows a single annotate toggle while no notes are pending', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: { ...CAPABILITIES, annotatePreview: true },
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		// One command means no collapsed variant: a second control would be a
		// duplicate of this one at every width, and a menu wrapping it would be
		// a single-item dropdown.
		expect( screen.getAllByRole( 'button', { name: 'Annotate' } ) ).toHaveLength( 1 );
		expect(
			screen.queryByRole( 'button', { name: 'Annotation options' } )
		).not.toBeInTheDocument();
	} );

	it( 'hides the Annotate control when agentic features are off', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: { ...CAPABILITIES, annotatePreview: true },
		} as never );
		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: true,
			chatEnabled: false,
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
			reason: null,
			isReady: true,
		} );
	} );

	it( 'offers responsive modes from the More options menu while running', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
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

	it( 'toggles full preview from the More options menu', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		const onFullscreenChange = vi.fn();
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		const ui = ( fullscreen: boolean ) => (
			<QueryClientProvider client={ queryClient }>
				<Tooltip.Provider>
					<SitePreview
						site={ createSite( { running: true } ) }
						path="/"
						reloadNonce={ 0 }
						fullscreen={ fullscreen }
						onFullscreenChange={ onFullscreenChange }
					/>
				</Tooltip.Provider>
			</QueryClientProvider>
		);

		const { rerender } = render( ui( false ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'More options' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Full preview' } ) );

		expect( onFullscreenChange ).toHaveBeenCalledWith( true );

		// While full, the same item offers the way back out.
		rerender( ui( true ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'More options' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Exit full preview' } ) );

		expect( onFullscreenChange ).toHaveBeenLastCalledWith( false );
	} );

	it( 'omits full preview when the host provides no toggle', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'More options' } ) );

		expect( await screen.findByText( 'Responsive mode' ) ).toBeVisible();
		expect( screen.queryByRole( 'menuitem', { name: 'Full preview' } ) ).not.toBeInTheDocument();
	} );

	it( 'asks for full preview when the Desktop + Mobile comparison is picked', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		const onFullscreenChange = vi.fn();

		renderPreview(
			<SitePreview
				site={ createSite( { running: true } ) }
				path="/"
				reloadNonce={ 0 }
				onFullscreenChange={ onFullscreenChange }
			/>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'More options' } ) );
		fireEvent.click( await screen.findByRole( 'menuitemradio', { name: 'Desktop + Mobile' } ) );

		expect( onFullscreenChange ).toHaveBeenCalledWith( true );
	} );

	it( 'drops the comparison back to Fit pane when full preview ends', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		const ui = ( fullscreen: boolean ) => (
			<QueryClientProvider client={ queryClient }>
				<Tooltip.Provider>
					<SitePreview
						site={ createSite( { running: true } ) }
						path="/"
						reloadNonce={ 0 }
						fullscreen={ fullscreen }
						onFullscreenChange={ vi.fn() }
					/>
				</Tooltip.Provider>
			</QueryClientProvider>
		);

		const { rerender } = render( ui( true ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'More options' } ) );
		fireEvent.click( await screen.findByRole( 'menuitemradio', { name: 'Desktop + Mobile' } ) );
		expect( screen.getByRole( 'menuitemradio', { name: 'Desktop + Mobile' } ) ).toBeChecked();

		// Two frames don't fit the panel, so the comparison doesn't survive the
		// return to the split layout.
		rerender( ui( false ) );

		expect( await screen.findByRole( 'menuitemradio', { name: 'Fit pane' } ) ).toBeChecked();
	} );

	it( 'toggles full preview with the keyboard shortcut', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		const onFullscreenChange = vi.fn();
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		const ui = ( props: Partial< ComponentProps< typeof SitePreview > > ) => (
			<QueryClientProvider client={ queryClient }>
				<Tooltip.Provider>
					<SitePreview
						site={ createSite( { running: true } ) }
						path="/"
						reloadNonce={ 0 }
						{ ...props }
					/>
				</Tooltip.Provider>
			</QueryClientProvider>
		);
		// jsdom reports a non-Apple platform, so the chord is Ctrl+Shift+F.
		const pressShortcut = () =>
			fireEvent.keyDown( document, { key: 'f', ctrlKey: true, shiftKey: true } );

		const { rerender, unmount } = render( ui( { onFullscreenChange } ) );
		pressShortcut();
		expect( onFullscreenChange ).toHaveBeenLastCalledWith( true );

		// It's a toggle, so it reads the current state on the way back out.
		rerender( ui( { fullscreen: true, onFullscreenChange } ) );
		pressShortcut();
		expect( onFullscreenChange ).toHaveBeenLastCalledWith( false );

		// Without a host toggle the chord stays with the page.
		unmount();
		render( ui( {} ) );
		onFullscreenChange.mockClear();
		pressShortcut();
		expect( onFullscreenChange ).not.toHaveBeenCalled();
	} );

	it( 'hides the More options menu when the site is not running', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview( <SitePreview site={ createSite() } path="/" reloadNonce={ 0 } /> );

		expect( screen.queryByRole( 'button', { name: 'More options' } ) ).not.toBeInTheDocument();
	} );

	it( 'remembers the responsive mode per site during the session', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
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

// The simulated viewport is derived from the observed pane size, and jsdom has
// no ResizeObserver — without one the preview never leaves "fit pane" and no
// emulation is ever requested. Reports a fixed pane synchronously on observe.
const PANE_SIZE = { width: 900, height: 700 };

class ResizeObserverStub {
	constructor( private readonly callback: ResizeObserverCallback ) {}
	observe( target: Element ) {
		this.callback(
			[ { target, contentRect: PANE_SIZE } ] as unknown as ResizeObserverEntry[],
			this as unknown as ResizeObserver
		);
	}
	unobserve() {}
	disconnect() {}
}

function renderWebviewPreview( props: Partial< ComponentProps< typeof SitePreview > > = {} ) {
	setUserAgent( `${ REAL_USER_AGENT } Electron/38.0.0` );
	vi.stubGlobal( 'ResizeObserver', ResizeObserverStub );
	const clearWebviewCache = vi.fn().mockResolvedValue( undefined );
	const setWebviewViewport = vi.fn().mockResolvedValue( undefined );
	vi.stubGlobal( 'ipcApi', { clearWebviewCache, setWebviewViewport } );
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
				<Tooltip.Provider>
					<SitePreview
						site={ createSite( { running: true } ) }
						path="/"
						reloadNonce={ 0 }
						{ ...props }
						{ ...next }
					/>
				</Tooltip.Provider>
			</QueryClientProvider>
		);
	return { webview, clearWebviewCache, setWebviewViewport, update };
}

// Leaves "fit pane" for one of the simulated presets, which is what turns the
// CDP emulation on.
async function selectResponsiveMode( label: string ) {
	fireEvent.click( screen.getByRole( 'button', { name: 'More options' } ) );
	fireEvent.click( await screen.findByRole( 'menuitemradio', { name: label } ) );
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

describe( 'SitePreview responsive emulation', () => {
	afterEach( () => {
		vi.unstubAllGlobals();
		setUserAgent( REAL_USER_AGENT );
	} );

	it( 'applies the simulated viewport when a preset is picked', async () => {
		const { setWebviewViewport } = renderWebviewPreview();

		await selectResponsiveMode( 'Desktop · 1440×900' );

		await waitFor( () =>
			expect( setWebviewViewport ).toHaveBeenCalledWith( 7, {
				width: 1440,
				height: 900,
				// Scaled to fit the pane; its width is the tighter of the two axes.
				scale: PANE_SIZE.width / 1440,
				mobile: false,
			} )
		);
	} );

	it( 're-applies the simulated viewport after each load', async () => {
		const { webview, setWebviewViewport } = renderWebviewPreview();
		await selectResponsiveMode( 'Desktop · 1440×900' );
		await waitFor( () => expect( setWebviewViewport ).toHaveBeenCalledTimes( 1 ) );

		// The override lives on the guest's debugger session, so a guest that
		// went away takes it with it. Re-asserting per load is what heals that.
		fireEvent( webview, new Event( 'dom-ready' ) );

		await waitFor( () => expect( setWebviewViewport ).toHaveBeenCalledTimes( 2 ) );
		expect( setWebviewViewport ).toHaveBeenLastCalledWith(
			7,
			expect.objectContaining( { width: 1440, height: 900 } )
		);
	} );

	it( 'never touches the emulation for a fit-to-pane preview', async () => {
		const { webview, setWebviewViewport } = renderWebviewPreview();

		fireEvent( webview, new Event( 'dom-ready' ) );

		await waitFor( () => expect( webview.executeJavaScript ).toHaveBeenCalled() );
		expect( setWebviewViewport ).not.toHaveBeenCalled();
	} );
} );
