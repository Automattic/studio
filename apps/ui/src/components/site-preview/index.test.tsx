import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ariaKeyShortcut } from '@wordpress/keycodes';
import { Tooltip } from '@wordpress/ui';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { themeDetailsQueryKey } from '@/hooks/use-theme-details';
import { DATABASE_HOME_PATH } from './address-bar';
import { INSPECTOR_BRIDGE_PREFIX } from './inspector-script';
import {
	getBrowserShortcutCommand,
	getDirectionalHistoryEntries,
	getPreviewTabTitle,
	getTabCycleDirection,
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

afterEach( () => {
	window.localStorage.clear();
} );

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
	it( 'adds and closes independent browser tabs without removing the last tab', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		for ( let count = 0; count < 4; count++ ) {
			fireEvent.click( screen.getByRole( 'button', { name: 'New tab' } ) );
			fireEvent.click( screen.getByRole( 'menuitem', { name: 'Front-end' } ) );
		}

		expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 5 );
		expect( screen.getAllByRole( 'button', { name: 'Refresh', hidden: true } ) ).toHaveLength( 5 );

		for ( let count = 0; count < 5; count++ ) {
			fireEvent.click( screen.getAllByRole( 'button', { name: /Close Example Site/ } )[ 0 ] );
		}

		expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 1 );
		expect( screen.getByRole( 'tab' ) ).toHaveAttribute( 'aria-selected', 'true' );
	} );

	it( 'uses vertical wheel input to scroll an overflowing tab list', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		const tabList = screen.getByRole( 'tablist' );
		Object.defineProperties( tabList, {
			scrollWidth: { configurable: true, value: 600 },
			clientWidth: { configurable: true, value: 240 },
			scrollLeft: { configurable: true, value: 0, writable: true },
		} );

		fireEvent.wheel( tabList, { deltaX: 0, deltaY: 64 } );
		expect( tabList.scrollLeft ).toBe( 64 );

		document.documentElement.dir = 'rtl';
		fireEvent.wheel( tabList, { deltaX: 0, deltaY: 32 } );
		expect( tabList.scrollLeft ).toBe( 32 );
		document.documentElement.removeAttribute( 'dir' );
	} );

	it( 'temporarily makes blank tab-bar space clickable while address suggestions are open', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		const tabBar = screen.getByRole( 'tablist' ).parentElement?.parentElement?.parentElement;
		const draggableClassName = tabBar?.className;
		fireEvent.focus( screen.getByRole( 'textbox', { name: 'Address' } ) );
		expect( tabBar?.className ).not.toBe( draggableClassName );
		expect( screen.getByText( 'Destinations' ) ).toBeInTheDocument();

		fireEvent.pointerDown( tabBar! );
		fireEvent.mouseDown( tabBar! );
		fireEvent.click( tabBar! );
		expect( screen.queryByText( 'Destinations' ) ).not.toBeInTheDocument();
		expect( tabBar?.className ).toBe( draggableClassName );

		fireEvent.focus( screen.getByRole( 'textbox', { name: 'Address' } ) );
		fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Address' } ), { key: 'Escape' } );
		expect( tabBar?.className ).toBe( draggableClassName );
	} );

	it( "restores each site's open tabs, order, and active tab", () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		const preview = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'New tab' } ) );
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'WordPress' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'New tab' } ) );
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Database' } ) );

		const tabs = screen.getAllByRole( 'tab' );
		const dataTransfer = {
			effectAllowed: '',
			dropEffect: '',
			setData: vi.fn(),
			getData: vi.fn(),
		} as unknown as DataTransfer;
		fireEvent.dragStart( tabs[ 2 ].parentElement!, { dataTransfer } );
		fireEvent.dragOver( tabs[ 0 ].parentElement!, { dataTransfer } );
		fireEvent.drop( tabs[ 0 ].parentElement!, { dataTransfer } );
		preview.unmount();

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);
		expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [
			'wordpress · Database',
			'Example Site',
			'WordPress',
		] );
		expect( screen.getAllByRole( 'tab' )[ 0 ] ).toHaveAttribute( 'aria-selected', 'true' );
	} );

	it( 'toggles full preview directly from the tab bar', () => {
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

		const fullPreviewButton = screen.getByRole( 'button', { name: 'Full preview' } );
		expect( fullPreviewButton ).toHaveAttribute(
			'aria-keyshortcuts',
			ariaKeyShortcut.primaryShift( 'f' )
		);
		expect( fullPreviewButton ).toHaveAttribute( 'aria-pressed', 'false' );
		const iconCorners = fullPreviewButton.querySelectorAll( 'path' );
		expect( iconCorners ).toHaveLength( 4 );
		expect( iconCorners[ 0 ] ).toHaveAttribute( 'class', iconCorners[ 2 ].getAttribute( 'class' ) );
		expect( iconCorners[ 1 ] ).toHaveAttribute( 'class', iconCorners[ 3 ].getAttribute( 'class' ) );
		expect( iconCorners[ 0 ].getAttribute( 'class' ) ).not.toBe(
			iconCorners[ 1 ].getAttribute( 'class' )
		);
		fireEvent.click( fullPreviewButton );
		expect( onFullscreenChange ).toHaveBeenCalledWith( true );
	} );

	it( 'moves the macOS traffic lights only while full preview is active', async () => {
		const setTrafficLightPosition = vi.fn().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
			reservesTrafficLightSpace: true,
			setTrafficLightPosition,
		} as never );
		const preview = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);
		await waitFor( () => expect( setTrafficLightPosition ).toHaveBeenLastCalledWith( 'default' ) );

		preview.rerender(
			<QueryClientProvider client={ preview.queryClient }>
				<Tooltip.Provider>
					<SitePreview
						site={ createSite( { running: true } ) }
						path="/"
						reloadNonce={ 0 }
						fullscreen
					/>
				</Tooltip.Provider>
			</QueryClientProvider>
		);
		await waitFor( () =>
			expect( setTrafficLightPosition ).toHaveBeenLastCalledWith( 'preview-tabs' )
		);
	} );

	it( 'keeps each tab at its own URL when switching between them', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		function PreviewHarness() {
			const [ currentPath, setCurrentPath ] = useState( '/about/' );
			return (
				<SitePreview
					site={ createSite( { running: true } ) }
					path={ currentPath }
					reloadNonce={ 0 }
					onPathChange={ setCurrentPath }
				/>
			);
		}

		renderPreview( <PreviewHarness /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'New tab' } ) );
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Front-end' } ) );

		let address = screen.getByRole( 'textbox', { name: 'Address' } );
		expect( address ).toHaveValue( 'http://localhost:8881/' );
		fireEvent.change( address, { target: { value: 'http://localhost:8881/contact/' } } );
		fireEvent.submit( address.closest( 'form' )! );
		expect( address ).toHaveValue( 'http://localhost:8881/contact/' );

		const tabs = screen.getAllByRole( 'tab' );
		fireEvent.click( tabs[ 0 ] );
		address = screen.getByRole( 'textbox', { name: 'Address' } );
		expect( address ).toHaveValue( 'http://localhost:8881/about/' );

		fireEvent.click( tabs[ 1 ] );
		expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
			'http://localhost:8881/contact/'
		);
	} );

	it( 'offers default destinations and remembers submitted addresses per site', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		function PreviewHarness( { site }: { site: SiteDetails } ) {
			const [ currentPath, setCurrentPath ] = useState( '/' );
			return (
				<SitePreview
					site={ site }
					path={ currentPath }
					reloadNonce={ 0 }
					onPathChange={ setCurrentPath }
				/>
			);
		}

		const firstSite = createSite( { id: 'first-site', running: true } );
		const preview = renderPreview( <PreviewHarness site={ firstSite } /> );
		let address = screen.getByRole( 'textbox', { name: 'Address' } );
		fireEvent.focus( address );

		expect( screen.getByText( 'Destinations' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Front-end' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'WordPress' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Database' } ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Recent' ) ).not.toBeInTheDocument();

		fireEvent.change( address, {
			target: { value: 'http://localhost:8881/contact/' },
		} );
		fireEvent.submit( address.closest( 'form' )! );
		expect( screen.queryByText( 'Destinations' ) ).not.toBeInTheDocument();

		fireEvent.focus( address );
		expect( screen.getByText( 'Recent' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'http://localhost:8881/contact/' } )
		).toBeInTheDocument();
		preview.unmount();

		const restored = renderPreview( <PreviewHarness site={ firstSite } /> );
		address = screen.getByRole( 'textbox', { name: 'Address' } );
		fireEvent.focus( address );
		expect(
			screen.getByRole( 'button', { name: 'http://localhost:8881/contact/' } )
		).toBeInTheDocument();
		restored.unmount();

		renderPreview(
			<PreviewHarness site={ createSite( { id: 'second-site', port: 8882, running: true } ) } />
		);
		fireEvent.focus( screen.getByRole( 'textbox', { name: 'Address' } ) );
		expect(
			screen.queryByRole( 'button', { name: 'http://localhost:8881/contact/' } )
		).not.toBeInTheDocument();
	} );

	it( 'offers each preview realm when adding a tab', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		const { container } = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'New tab' } ) );
		expect( screen.getByRole( 'menuitem', { name: 'Front-end' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'menuitem', { name: 'WordPress' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'menuitem', { name: 'Database' } ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'menuitem', { name: 'WordPress' } ) );
		expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 2 );
		expect( container.querySelector( '[data-realm="admin"] svg' ) ).toBeInTheDocument();
	} );

	it( 'uses realm-specific favicons in browser tabs', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		const siteIcon = 'data:image/png;base64,c2l0ZS1pY29u';

		const frontend = renderPreview(
			<SitePreview site={ createSite( { running: true, siteIcon } ) } path="/" reloadNonce={ 0 } />
		);
		expect( frontend.container.querySelector( '[data-realm="frontend"] img' ) ).toHaveAttribute(
			'src',
			siteIcon
		);
		frontend.unmount();
		window.localStorage.clear();

		const admin = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/wp-admin/" reloadNonce={ 0 } />
		);
		expect( admin.container.querySelector( '[data-realm="admin"] svg' ) ).toBeInTheDocument();
		admin.unmount();
		window.localStorage.clear();

		const database = renderPreview(
			<SitePreview
				site={ createSite( { running: true } ) }
				path={ DATABASE_HOME_PATH }
				reloadNonce={ 0 }
			/>
		);
		expect( database.container.querySelector( '[data-realm="database"] svg' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'tab' ) ).toHaveTextContent( 'wordpress · Database' );
	} );

	it( 'uses useful database and table names instead of phpMyAdmin document titles', () => {
		expect( getPreviewTabTitle( DATABASE_HOME_PATH, 'phpMyAdmin 5.2.1', 'Example Site' ) ).toBe(
			'wordpress · Database'
		);
		expect(
			getPreviewTabTitle(
				'/phpmyadmin/index.php?route=/table/browse&db=wordpress&table=wp_posts',
				'phpMyAdmin 5.2.1',
				'Example Site'
			)
		).toBe( 'wp_posts · wordpress' );
	} );

	it( 'reorders tabs as they are dragged over one another', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'New tab' } ) );
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'WordPress' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'New tab' } ) );
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Database' } ) );

		const tabs = screen.getAllByRole( 'tab' );
		const data = new Map< string, string >();
		const dataTransfer = {
			effectAllowed: '',
			dropEffect: '',
			setData: ( type: string, value: string ) => {
				data.set( type, value );
			},
			getData: ( type: string ) => data.get( type ) ?? '',
		} as unknown as DataTransfer;
		fireEvent.dragStart( tabs[ 2 ].parentElement!, { dataTransfer } );
		fireEvent.dragOver( tabs[ 0 ].parentElement!, { dataTransfer } );

		expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [
			'wordpress · Database',
			'Example Site',
			'WordPress',
		] );
		fireEvent.drop( tabs[ 0 ].parentElement!, { dataTransfer } );
	} );

	it( 'cycles through tabs with browser-standard keyboard shortcuts', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'New tab' } ) );
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'WordPress' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'New tab' } ) );
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Database' } ) );

		fireEvent.keyDown( document, { key: 'Tab', ctrlKey: true } );
		expect( screen.getAllByRole( 'tab' )[ 0 ] ).toHaveAttribute( 'aria-selected', 'true' );
		fireEvent.keyDown( document, { key: 'Tab', ctrlKey: true, shiftKey: true } );
		expect( screen.getAllByRole( 'tab' )[ 2 ] ).toHaveAttribute( 'aria-selected', 'true' );
	} );

	it( 'does not reuse back and forward shortcuts for cycling tabs', () => {
		expect(
			getTabCycleDirection( new KeyboardEvent( 'keydown', { key: '[', metaKey: true } ) )
		).toBe( null );
		expect(
			getTabCycleDirection(
				new KeyboardEvent( 'keydown', { key: 'Tab', ctrlKey: true, shiftKey: true } )
			)
		).toBe( -1 );
	} );

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
		expect( screen.queryByRole( 'tablist', { name: 'Preview tabs' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'New tab' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Full preview' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Start site' } ) ).toBeVisible();
		expect( container.querySelector( 'canvas' ) ).toBeInTheDocument();
		await waitFor( () => expect( getSiteThumbnail ).toHaveBeenCalledWith( 'site-1' ) );

		expect(
			await screen.findByRole( 'img', { name: 'Screenshot of Example Site' } )
		).toHaveAttribute( 'src', 'data:image/png;base64,thumbnail' );
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
		const backButton = screen.getByRole( 'button', { name: 'Back' } );
		const forwardButton = screen.getByRole( 'button', { name: 'Forward' } );
		expect( refreshButton ).toBeEnabled();
		expect( refreshButton ).toHaveAttribute( 'aria-keyshortcuts', expect.stringMatching( /\+R$/ ) );
		expect( backButton.compareDocumentPosition( forwardButton ) ).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect( forwardButton.compareDocumentPosition( refreshButton ) ).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);

		// jsdom reports a non-Apple platform: the navigation alias is Alt+arrow,
		// with the bracket chord kept as a secondary shortcut.
		expect( backButton ).toHaveAttribute( 'aria-keyshortcuts', 'Alt+ArrowLeft Control+[' );
		expect( forwardButton ).toHaveAttribute( 'aria-keyshortcuts', 'Alt+ArrowRight Control+]' );

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

	it( 'keeps browser shortcuts active when browser chrome has focus', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		const { container } = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		const tab = screen.getByRole( 'tab' );
		tab.focus();
		let iframe = container.querySelector( 'iframe' );
		fireEvent.keyDown( tab, { key: 'r', ctrlKey: true } );
		expect( container.querySelector( 'iframe' ) ).not.toBe( iframe );

		const address = screen.getByRole( 'textbox', { name: 'Address' } );
		address.focus();
		iframe = container.querySelector( 'iframe' );
		fireEvent.keyDown( address, { key: 'r', ctrlKey: true } );
		expect( container.querySelector( 'iframe' ) ).not.toBe( iframe );
	} );

	it( 'does not reserve primary-modifier number shortcuts', () => {
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

		const event = new KeyboardEvent( 'keydown', { key: '2', ctrlKey: true, cancelable: true } );
		document.body.dispatchEvent( event );

		expect( event.defaultPrevented ).toBe( false );
		expect( onPathChange ).not.toHaveBeenCalled();
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
				<Tooltip.Provider>
					<SitePreview site={ createSite( { running: true } ) } path={ path } reloadNonce={ 0 } />
				</Tooltip.Provider>
			</QueryClientProvider>
		);

		const { container, rerender } = render( ui( '/' ) );
		expect( container.querySelectorAll( 'iframe' ) ).toHaveLength( 1 );

		// The two realms that link to each other and share a login stay a single
		// surface, so history and session carry across them.
		rerender( ui( '/wp-admin/' ) );
		expect( container.querySelectorAll( 'iframe' ) ).toHaveLength( 1 );
	} );

	it( 'gives the database its own surface and reveals it without reloading', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );
		const onPathChange = vi.fn();
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		const ui = ( path: string ) => (
			<QueryClientProvider client={ queryClient }>
				<Tooltip.Provider>
					<SitePreview
						site={ createSite( { running: true } ) }
						path={ path }
						reloadNonce={ 0 }
						onPathChange={ onPathChange }
					/>
				</Tooltip.Provider>
			</QueryClientProvider>
		);

		const { container, rerender } = render( ui( '/' ) );
		const siteSurface = container.querySelector( 'iframe' );

		// The database mounts alongside the site surface rather than replacing it,
		// and the site layer is hidden rather than torn down.
		rerender( ui( DATABASE_HOME_PATH ) );
		expect( container.querySelectorAll( 'iframe' ) ).toHaveLength( 2 );
		expect( siteSurface?.closest( '[inert]' ) ).not.toBeNull();
		const databaseSurface = container.querySelectorAll( 'iframe' )[ 1 ];

		// Leaving and returning is a visibility swap: both elements survive, so
		// neither the site nor the database reloads, and the database is
		// reactivated at its own path instead of being renavigated.
		rerender( ui( '/' ) );
		expect( container.querySelector( 'iframe' ) ).toBe( siteSurface );
		expect( siteSurface?.closest( '[inert]' ) ).toBeNull();

		rerender( ui( DATABASE_HOME_PATH ) );
		expect( container.querySelectorAll( 'iframe' ) ).toHaveLength( 2 );
		expect( container.querySelectorAll( 'iframe' )[ 1 ] ).toBe( databaseSurface );
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

	it( 'prioritizes annotation controls while picking', () => {
		const originalUserAgent = navigator.userAgent;
		Object.defineProperty( navigator, 'userAgent', {
			configurable: true,
			value: `${ originalUserAgent } Electron/40.0.0`,
		} );
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: { ...CAPABILITIES, annotatePreview: true },
		} as never );

		const { container } = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);
		const webview = container.querySelector( 'webview' );
		expect( webview ).toBeInTheDocument();

		const stateEvent = new Event( 'console-message' );
		Object.defineProperty( stateEvent, 'message', {
			value: `${ INSPECTOR_BRIDGE_PREFIX }${ JSON.stringify( {
				type: 'state',
				isPicking: true,
				annotationCount: 0,
			} ) }`,
		} );
		fireEvent( webview as Element, stateEvent );

		const cancelButton = screen.getByRole( 'button', { name: 'Cancel annotation' } );
		expect( cancelButton ).toBeVisible();
		expect( cancelButton.querySelector( 'svg' ) ).toBeNull();
		expect( cancelButton ).not.toHaveAttribute( 'aria-pressed' );
		expect( screen.queryByRole( 'button', { name: 'Back' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Forward' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Refresh' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'textbox', { name: 'Address' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Responsive mode: Fit' } ) ).toBeVisible();

		Object.defineProperty( navigator, 'userAgent', {
			configurable: true,
			value: originalUserAgent,
		} );
	} );

	it( 'confirms before discarding an annotation session', async () => {
		const originalUserAgent = navigator.userAgent;
		Object.defineProperty( navigator, 'userAgent', {
			configurable: true,
			value: `${ originalUserAgent } Electron/40.0.0`,
		} );
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: { ...CAPABILITIES, annotatePreview: true },
		} as never );

		const { container } = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);
		const webview = container.querySelector( 'webview' );
		const stateEvent = new Event( 'console-message' );
		Object.defineProperty( stateEvent, 'message', {
			value: `${ INSPECTOR_BRIDGE_PREFIX }${ JSON.stringify( {
				type: 'state',
				isPicking: true,
				annotationCount: 0,
			} ) }`,
		} );
		fireEvent( webview as Element, stateEvent );

		const emptyCancelRequest = new Event( 'console-message' );
		Object.defineProperty( emptyCancelRequest, 'message', {
			value: `${ INSPECTOR_BRIDGE_PREFIX }${ JSON.stringify( {
				type: 'cancel-requested',
			} ) }`,
		} );
		fireEvent( webview as Element, emptyCancelRequest );
		expect(
			screen.queryByRole( 'dialog', { name: 'Cancel annotation?' } )
		).not.toBeInTheDocument();

		const draftStateEvent = new Event( 'console-message' );
		Object.defineProperty( draftStateEvent, 'message', {
			value: `${ INSPECTOR_BRIDGE_PREFIX }${ JSON.stringify( {
				type: 'state',
				isPicking: true,
				annotationCount: 0,
				hasUnsavedDraft: true,
			} ) }`,
		} );
		fireEvent( webview as Element, draftStateEvent );

		const draftCancelRequest = new Event( 'console-message' );
		Object.defineProperty( draftCancelRequest, 'message', {
			value: `${ INSPECTOR_BRIDGE_PREFIX }${ JSON.stringify( {
				type: 'cancel-requested',
			} ) }`,
		} );
		fireEvent( webview as Element, draftCancelRequest );
		expect( screen.getByRole( 'dialog', { name: 'Cancel annotation?' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Keep annotating' } ) );
		await waitFor( () =>
			expect(
				screen.queryByRole( 'dialog', { name: 'Cancel annotation?' } )
			).not.toBeInTheDocument()
		);

		fireEvent.keyDown( document, { key: 'Escape' } );
		expect( screen.getByRole( 'dialog', { name: 'Cancel annotation?' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Discard annotations' } ) );
		await waitFor( () =>
			expect(
				screen.queryByRole( 'dialog', { name: 'Cancel annotation?' } )
			).not.toBeInTheDocument()
		);

		Object.defineProperty( navigator, 'userAgent', {
			configurable: true,
			value: originalUserAgent,
		} );
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

	it( 'offers responsive modes from the responsive preview menu while running', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Responsive mode: Fit' } ) );

		expect( await screen.findByText( 'Viewport width' ) ).toBeVisible();
		expect( screen.getByRole( 'menuitem', { name: 'Fit' } ) ).toBeVisible();
		expect( screen.queryByRole( 'menuitemradio', { name: 'Fit' } ) ).not.toBeInTheDocument();
		// The orientation group only accompanies the phone frame.
		expect( screen.queryByText( 'Mobile orientation' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Mobile · 390×844' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Responsive mode: Mobile' } ) );

		expect( await screen.findByText( 'Mobile orientation' ) ).toBeVisible();
		expect( screen.getByRole( 'menuitemradio', { name: 'Portrait' } ) ).toBeChecked();

		// The menu is modal: its backdrop covers the webview, so clicks over
		// the preview dismiss the menu instead of vanishing into the guest.
		const backdrop = document.querySelector( '[role="presentation"][data-base-ui-inert]' );
		expect( backdrop ).toBeInTheDocument();
		fireEvent.pointerDown( backdrop as Element );
		await waitFor( () => expect( screen.queryByText( 'Viewport width' ) ).not.toBeInTheDocument() );
	} );

	it( 'disables the responsive mode controls while previewing the database realm', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview
				site={ createSite( { running: true } ) }
				path={ DATABASE_HOME_PATH }
				reloadNonce={ 0 }
			/>
		);

		const responsiveButton = screen.getByRole( 'button', {
			name: 'Responsive mode: Fit',
		} );
		expect( responsiveButton ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( responsiveButton ).toHaveAttribute( 'aria-description', 'Not available for Database' );
		expect( responsiveButton.parentElement ).toHaveAttribute(
			'title',
			'Not available for Database'
		);

		fireEvent.click( responsiveButton );
		expect(
			screen.queryByRole( 'menuitem', { name: 'Mobile · 390×844' } )
		).not.toBeInTheDocument();
	} );

	it( 'keeps full preview out of the responsive controls', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Responsive mode: Fit' } ) );

		expect( await screen.findByText( 'Viewport width' ) ).toBeVisible();
		expect( screen.queryByRole( 'menuitem', { name: 'Full preview' } ) ).not.toBeInTheDocument();
	} );

	it( 'does not force full preview when the Desktop + Mobile comparison is picked', async () => {
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

		fireEvent.click( screen.getByRole( 'button', { name: 'Responsive mode: Fit' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Desktop + Mobile' } ) );

		expect( onFullscreenChange ).not.toHaveBeenCalled();
	} );

	it( 'keeps the comparison selected when full preview ends', async () => {
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
		fireEvent.click( screen.getByRole( 'button', { name: 'Responsive mode: Fit' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Desktop + Mobile' } ) );

		rerender( ui( false ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Responsive mode: Desktop + Mobile' } ) );
		expect( screen.getByRole( 'menuitem', { name: 'Desktop + Mobile' } ) ).toHaveAttribute(
			'aria-current',
			'true'
		);
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

	it( 'hides the responsive controls when the site is not running', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview( <SitePreview site={ createSite() } path="/" reloadNonce={ 0 } /> );

		expect(
			screen.queryByRole( 'button', { name: 'Responsive mode: Fit' } )
		).not.toBeInTheDocument();
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
		fireEvent.click( screen.getByRole( 'button', { name: 'Responsive mode: Fit' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Mobile · 390×844' } ) );

		// A site without a remembered mode starts from the default…
		rerender( ui( siteB ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Responsive mode: Fit' } ) );
		expect( screen.getByRole( 'menuitem', { name: 'Fit' } ) ).toHaveAttribute(
			'aria-current',
			'true'
		);

		// …and returning to the first site restores its mode.
		rerender( ui( siteA ) );
		expect( screen.getByRole( 'menuitem', { name: 'Mobile · 390×844' } ) ).toHaveAttribute(
			'aria-current',
			'true'
		);
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
	const restoreWebviewNavigationHistory = vi.fn().mockResolvedValue( undefined );
	const getWebviewNavigationHistory = vi.fn().mockResolvedValue( {
		activeIndex: 0,
		entries: [],
	} );
	vi.stubGlobal( 'ipcApi', {
		clearWebviewCache,
		setWebviewViewport,
		restoreWebviewNavigationHistory,
		getWebviewNavigationHistory,
	} );
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
	return {
		webview,
		clearWebviewCache,
		setWebviewViewport,
		restoreWebviewNavigationHistory,
		update,
	};
}

// Leaves "Fit" for one of the simulated presets, which is what turns the
// CDP emulation on.
async function selectResponsiveMode( label: string ) {
	fireEvent.click( screen.getByRole( 'button', { name: /Responsive mode:/ } ) );
	fireEvent.click( await screen.findByRole( 'menuitem', { name: label } ) );
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

	it( 'restores a persisted navigation history stack', async () => {
		window.localStorage.setItem(
			'studio:site-preview:tabs:site-1',
			JSON.stringify( {
				version: 1,
				activeTabId: 1,
				tabs: [
					{
						id: 1,
						path: '/second/',
						title: 'Second',
						activeHistoryIndex: 1,
						historyEntries: [
							{ index: 0, title: 'First', url: 'http://localhost:8881/first/' },
							{ index: 1, title: 'Second', url: 'http://localhost:8881/second/' },
						],
					},
				],
			} )
		);
		const { restoreWebviewNavigationHistory } = renderWebviewPreview();

		await waitFor( () =>
			expect( restoreWebviewNavigationHistory ).toHaveBeenCalledWith(
				7,
				[
					{ index: 0, title: 'First', url: 'http://localhost:8881/first/' },
					{ index: 1, title: 'Second', url: 'http://localhost:8881/second/' },
				],
				1
			)
		);
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
				// Scaled to fit the padded pane; its width is the tighter of the two axes.
				scale: ( PANE_SIZE.width - 32 ) / 1440,
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
