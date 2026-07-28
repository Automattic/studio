import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useIsSiteStarting, useIsSiteStopping, useStartSite } from '@/data/queries/use-sites';
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
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
	useStartSite: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useStartSiteMock = vi.mocked( useStartSite, { partial: true } );
const useUserPreferencesMock = vi.mocked( useUserPreferences, { partial: true } );

const BROWSER_URL = 'http://localhost:8881/about/';

describe( 'OpenInMenu', () => {
	const openSiteUrl = vi.fn().mockResolvedValue( undefined );
	const openExternalUrl = vi.fn().mockResolvedValue( undefined );
	const openSiteFolder = vi.fn().mockResolvedValue( undefined );
	const openSiteInEditor = vi.fn().mockResolvedValue( undefined );
	const openSiteInTerminal = vi.fn().mockResolvedValue( undefined );
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
			getSites: vi.fn().mockResolvedValue( [] ),
		} );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
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

	it( 'routes each destination through the connector', async () => {
		renderMenu( { running: true } );

		fireEvent.click( destination( 'Browser' ) );
		fireEvent.click( destination( /^(Finder|File Explorer|File manager)$/ ) );
		fireEvent.click( destination( 'Zed' ) );
		fireEvent.click( destination( 'Terminal' ) );
		fireEvent.click( destination( 'phpMyAdmin' ) );

		expect( openExternalUrl ).toHaveBeenCalledWith( BROWSER_URL );
		expect( openSiteFolder ).toHaveBeenCalledWith( 'site-1' );
		expect( openSiteInEditor ).toHaveBeenCalledWith( 'site-1' );
		expect( openSiteInTerminal ).toHaveBeenCalledWith( 'site-1' );
		await waitFor( () =>
			expect( openSiteUrl ).toHaveBeenCalledWith(
				'site-1',
				'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
			)
		);
		expect( startSite ).not.toHaveBeenCalled();
	} );

	it( 'defaults the split action to the browser', () => {
		renderMenu( { running: true } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Open in Browser' } ) );

		expect( openExternalUrl ).toHaveBeenCalledWith( BROWSER_URL );
	} );

	it( 'stays available while the site is stopped, minus the browser', () => {
		renderMenu( { running: false } );

		expect( destination( 'Browser' ) ).toBeDisabled();
		expect( screen.getByRole( 'button', { name: 'Open in Browser' } ) ).toBeDisabled();

		fireEvent.click( destination( /^(Finder|File Explorer|File manager)$/ ) );
		expect( openSiteFolder ).toHaveBeenCalledWith( 'site-1' );
	} );

	it( 'starts a stopped site before opening phpMyAdmin', async () => {
		renderMenu( { running: false } );

		expect( destination( 'phpMyAdmin' ) ).toBeEnabled();
		fireEvent.click( destination( 'phpMyAdmin' ) );

		await waitFor( () => expect( startSite ).toHaveBeenCalledWith( 'site-1' ) );
		await waitFor( () =>
			expect( openSiteUrl ).toHaveBeenCalledWith(
				'site-1',
				'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
			)
		);
	} );

	it( 'sends the user to settings when no editor is configured', () => {
		useUserPreferencesMock.mockReturnValue( { data: undefined } );

		renderMenu( { running: true } );

		fireEvent.click( destination( 'Editor' ) );

		expect( navigateMock ).toHaveBeenCalledWith( { to: '/settings' } );
		expect( openSiteInEditor ).not.toHaveBeenCalled();
		// Nothing was opened, so the trigger's last-used destination stays put.
		expect( window.localStorage.getItem( 'studio:open-in-menu:last-used' ) ).toBeNull();
	} );

	it( 'repeats the last used destination from the split action', () => {
		renderMenu( { running: true } );

		fireEvent.click( destination( 'Terminal' ) );
		expect( window.localStorage.getItem( 'studio:open-in-menu:last-used' ) ).toBe( 'terminal' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Open in Terminal' } ) );
		expect( openSiteInTerminal ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'restores the persisted destination and ignores a corrupt one', () => {
		window.localStorage.setItem( 'studio:open-in-menu:last-used', 'terminal' );
		const { unmount } = renderMenu( { running: true } );
		expect( screen.getByRole( 'button', { name: 'Open in Terminal' } ) ).toBeInTheDocument();
		unmount();

		window.localStorage.setItem( 'studio:open-in-menu:last-used', 'nonsense' );
		renderMenu( { running: true } );
		expect( screen.getByRole( 'button', { name: 'Open in Browser' } ) ).toBeInTheDocument();
	} );
} );

function renderMenu( overrides: Partial< SiteDetails > = {} ) {
	return render( <OpenInMenu site={ createSite( overrides ) } browserUrl={ BROWSER_URL } /> );
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
