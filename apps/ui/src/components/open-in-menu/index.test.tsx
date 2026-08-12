import '@testing-library/jest-dom/vitest';
import { captureException } from '@studio/common/lib/error-reporting';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useStartSite } from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { OpenInMenu } from './index';
import type { SiteDetails } from '@/data/core';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

const navigateMock = vi.fn();

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigateMock,
} ) );

vi.mock( '@wordpress/ui', async () => {
	const { cloneElement } = await import( 'react' );
	return {
		Button: ( {
			children,
			tone,
			variant,
			size,
			...props
		}: ButtonHTMLAttributes< HTMLButtonElement > & {
			children?: ReactNode;
			tone?: string;
			variant?: string;
			size?: string;
		} ) => {
			void tone;
			void variant;
			void size;
			return <button { ...props }>{ children }</button>;
		},
		Tooltip: {
			Root: ( { children }: { children: ReactNode } ) => <>{ children }</>,
			Trigger: ( {
				render: renderProp,
				children,
			}: {
				render: React.ReactElement< { children?: ReactNode } >;
				children?: ReactNode;
			} ) => cloneElement( renderProp, {}, children ),
			Positioner: () => null,
			Popup: () => null,
		},
	};
} );

vi.mock( '@/components/menu', () => ( {
	Root: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	Trigger: ( { render: renderProp }: { render: ReactNode } ) => <>{ renderProp }</>,
	Popup: ( { children }: { children: ReactNode } ) => <div role="menu">{ children }</div>,
	Item: ( {
		children,
		onClick,
		disabled,
	}: {
		children: ReactNode;
		onClick?: () => void;
		disabled?: boolean;
	} ) => (
		<button type="button" onClick={ onClick } disabled={ disabled }>
			{ children }
		</button>
	),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useStartSite: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/error-reporting', () => ( {
	captureException: vi.fn(),
} ) );

vi.mock( '@/data/app-messages', () => ( {
	toast: { error: vi.fn() },
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const useStartSiteMock = vi.mocked( useStartSite, { partial: true } );
const useUserPreferencesMock = vi.mocked( useUserPreferences, { partial: true } );

const BROWSER_PATH = '/about/';

describe( 'OpenInMenu', () => {
	const openSiteUrl = vi.fn().mockResolvedValue( undefined );
	const openExternalUrl = vi.fn().mockResolvedValue( undefined );
	const openSiteFolder = vi.fn().mockResolvedValue( undefined );
	const openSiteInEditor = vi.fn().mockResolvedValue( undefined );
	const openSiteInTerminal = vi.fn().mockResolvedValue( undefined );
	const trackEvent = vi.fn().mockResolvedValue( undefined );
	const startSite = vi.fn().mockResolvedValue( undefined );

	beforeEach( () => {
		vi.clearAllMocks();
		window.localStorage.clear();
		useConnectorMock.mockReturnValue( {
			openSiteUrl,
			openExternalUrl,
			openSiteFolder,
			openSiteInEditor,
			openSiteInTerminal,
			trackEvent,
			getSites: vi.fn().mockResolvedValue( [] ),
		} );
		useStartSiteMock.mockReturnValue( {
			isPending: false,
			mutate: startSite,
			mutateAsync: startSite,
		} );
		useUserPreferencesMock.mockReturnValue( {
			data: {
				editor: 'zed',
				terminal: 'terminal',
				colorScheme: 'system',
				locale: undefined,
				analyticsEnabled: true,
				defaultSiteDirectory: '/Users/example/Studio',
				studioCliInstalled: false,
				studioCliExternallyManaged: false,
				agenticFeaturesEnabled: true,
			},
		} );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'routes each destination through the connector', async () => {
		renderMenu( { running: true } );

		fireEvent.click( destination( 'Browser' ) );
		fireEvent.click( destination( /^(Finder|File Explorer|File manager)$/ ) );
		fireEvent.click( destination( 'Zed' ) );
		fireEvent.click( destination( 'Terminal' ) );

		// The browser goes through the host's openSiteUrl, which wraps the path
		// in /studio-auto-login — opening it raw would hit the login form.
		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', BROWSER_PATH );
		expect( openExternalUrl ).not.toHaveBeenCalled();
		expect( openSiteFolder ).toHaveBeenCalledWith( 'site-1' );
		expect( openSiteInEditor ).toHaveBeenCalledWith( 'site-1' );
		expect( openSiteInTerminal ).toHaveBeenCalledWith( 'site-1' );
	} );

	it( 'reports terminal failures and tells the user', async () => {
		const error = new Error( 'Terminal unavailable' );
		openSiteInTerminal.mockRejectedValueOnce( error );
		const consoleErrorMock = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		renderMenu( { running: true } );

		fireEvent.click( destination( 'Terminal' ) );

		await waitFor( () => expect( captureException ).toHaveBeenCalledWith( error ) );
		expect( consoleErrorMock ).toHaveBeenCalledWith( 'Failed to open site in terminal:', error );
		expect( toast.error ).toHaveBeenCalledWith( 'Could not open the terminal.' );
	} );

	it( 'records Tracks events for browser and folder only (editor and terminal emit in Main)', () => {
		renderMenu( { running: true } );

		fireEvent.click( destination( 'Browser' ) );
		fireEvent.click( destination( /^(Finder|File Explorer|File manager)$/ ) );
		fireEvent.click( destination( 'Zed' ) );
		fireEvent.click( destination( 'Terminal' ) );

		expect( trackEvent ).toHaveBeenCalledWith( 'studio_site_open_in_browser', {
			browser: 'external',
		} );
		expect( trackEvent ).toHaveBeenCalledWith( 'studio_site_open_folder' );
		const trackedEvents = trackEvent.mock.calls.map( ( call ) => call[ 0 ] );
		expect( trackedEvents ).not.toContain( 'studio_site_open_in_editor' );
		expect( trackedEvents ).not.toContain( 'studio_site_open_in_terminal' );
	} );

	it( 'records the browser event matching the active preview realm', () => {
		renderMenu( { running: true }, '/wp-admin/plugins.php' );

		fireEvent.click( destination( 'Browser' ) );

		expect( trackEvent ).toHaveBeenCalledWith( 'studio_site_open_wp_admin', {
			browser: 'external',
		} );
	} );

	it( 'offers no phpMyAdmin destination', () => {
		// The preview's address bar owns the database realm; navigating there
		// from here strands it with no segment to represent it.
		renderMenu( { running: true } );

		expect( screen.queryByText( 'phpMyAdmin' ) ).not.toBeInTheDocument();
	} );

	it( 'defaults the split action to the browser', () => {
		renderMenu( { running: true } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Open in Browser' } ) );

		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', BROWSER_PATH );
	} );

	it( 'stays available while the site is stopped, minus the browser', () => {
		renderMenu( { running: false } );

		expect( destination( 'Browser' ) ).toBeDisabled();
		expect( screen.getByRole( 'button', { name: 'Open in Browser' } ) ).toBeDisabled();

		fireEvent.click( destination( /^(Finder|File Explorer|File manager)$/ ) );
		expect( openSiteFolder ).toHaveBeenCalledWith( 'site-1' );
	} );

	it( 'sends the user to settings when no editor is configured', () => {
		useUserPreferencesMock.mockReturnValue( { data: undefined } );

		renderMenu( { running: true } );

		fireEvent.click( destination( 'Editor' ) );

		expect( navigateMock ).toHaveBeenCalledWith( { to: '/settings' } );
		expect( openSiteInEditor ).not.toHaveBeenCalled();
		// Nothing was opened, so the trigger's last-used destination stays put.
		expect( window.localStorage.getItem( 'studio:open-in-menu:last-used:site-1' ) ).toBeNull();
	} );

	it( 'repeats the last used destination from the split action', () => {
		renderMenu( { running: true } );

		fireEvent.click( destination( 'Terminal' ) );
		expect( window.localStorage.getItem( 'studio:open-in-menu:last-used:site-1' ) ).toBe(
			'terminal'
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Open in Terminal' } ) );
		expect( openSiteInTerminal ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'remembers the destination per site', () => {
		window.localStorage.setItem( 'studio:open-in-menu:last-used:site-1', 'terminal' );
		window.localStorage.setItem( 'studio:open-in-menu:last-used:site-2', 'files' );

		const { unmount } = renderMenu( { running: true } );
		expect( screen.getByRole( 'button', { name: 'Open in Terminal' } ) ).toBeInTheDocument();
		unmount();

		renderMenu( { id: 'site-2', running: true } );
		expect(
			screen.getByRole( 'button', { name: /^Open in (Finder|File Explorer|File manager)$/ } )
		).toBeInTheDocument();
	} );

	it( 'restores the persisted destination and ignores a corrupt one', () => {
		window.localStorage.setItem( 'studio:open-in-menu:last-used:site-1', 'terminal' );
		const { unmount } = renderMenu( { running: true } );
		expect( screen.getByRole( 'button', { name: 'Open in Terminal' } ) ).toBeInTheDocument();
		unmount();

		window.localStorage.setItem( 'studio:open-in-menu:last-used:site-1', 'nonsense' );
		renderMenu( { running: true } );
		expect( screen.getByRole( 'button', { name: 'Open in Browser' } ) ).toBeInTheDocument();
	} );
} );

function renderMenu( overrides: Partial< SiteDetails > = {}, browserPath: string = BROWSER_PATH ) {
	return render( <OpenInMenu site={ createSite( overrides ) } browserPath={ browserPath } /> );
}

function destination( label: string | RegExp ): HTMLElement {
	return screen.getByText( label ).closest( 'button' )!;
}

function createSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	return {
		id: 'site-1',
		name: 'Demo Site',
		path: '/Users/example/Studio/demo-site',
		port: 8881,
		running: false,
		phpVersion: '8.4',
		adminUsername: 'admin',
		adminEmail: 'admin@example.com',
		enableDebugLog: true,
		...overrides,
	};
}
