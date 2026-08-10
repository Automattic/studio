import '@testing-library/jest-dom/vitest';
import { DEFAULT_ACTIVITY_SOUND_PREFERENCES } from '@studio/common/lib/activity-sounds';
import { captureException } from '@studio/common/lib/error-reporting';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import {
	useCopySite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteStarting,
	useIsSiteStopping,
	useStartSite,
} from '@/data/queries/use-sites';
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
	Separator: () => <hr />,
} ) );

vi.mock( '@/components/delete-site-dialog', () => ( {
	DeleteSiteDialog: ( { open }: { open: boolean } ) =>
		open ? <div role="dialog">Delete dialog</div> : null,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useCopySite: vi.fn(),
	useExportDatabase: vi.fn(),
	useExportFullSite: vi.fn(),
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
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
const useCopySiteMock = vi.mocked( useCopySite, { partial: true } );
const useExportDatabaseMock = vi.mocked( useExportDatabase, { partial: true } );
const useExportFullSiteMock = vi.mocked( useExportFullSite, { partial: true } );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useStartSiteMock = vi.mocked( useStartSite, { partial: true } );
const useUserPreferencesMock = vi.mocked( useUserPreferences, { partial: true } );

describe( 'OpenInMenu', () => {
	const openSiteUrl = vi.fn().mockResolvedValue( undefined );
	const openSiteFolder = vi.fn().mockResolvedValue( undefined );
	const openSiteInEditor = vi.fn().mockResolvedValue( undefined );
	const openSiteInTerminal = vi.fn().mockResolvedValue( undefined );
	const trackEvent = vi.fn().mockResolvedValue( undefined );
	const startSite = vi.fn().mockResolvedValue( undefined );
	const copySite = vi.fn();
	const exportFullSite = vi.fn();
	const exportDatabase = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		window.localStorage.clear();
		useConnectorMock.mockReturnValue( {
			openSiteUrl,
			openSiteFolder,
			openSiteInEditor,
			openSiteInTerminal,
			trackEvent,
		} );
		useCopySiteMock.mockReturnValue( { isPending: false, mutate: copySite } );
		useExportFullSiteMock.mockReturnValue( { isPending: false, mutate: exportFullSite } );
		useExportDatabaseMock.mockReturnValue( { isPending: false, mutate: exportDatabase } );
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
				frameColor: null,
				locale: undefined,
				analyticsEnabled: true,
				defaultSiteDirectory: '/Users/example/Studio',
				studioCliInstalled: false,
				studioCliExternallyManaged: false,
				agenticFeaturesEnabled: true,
				chatNotificationsEnabled: true,
				activitySoundPreferences: DEFAULT_ACTIVITY_SOUND_PREFERENCES,
				quitSitesBehavior: 'ask',
				agentResponseLength: 'normal',
				toolPermissions: {},
				defaultAiModel: 'claude-sonnet-5',
			},
		} );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'routes each destination through the connector', async () => {
		render( <OpenInMenu site={ createSite( { running: true } ) } browserPath="/about/" /> );

		fireEvent.click( screen.getByText( 'Browser' ).closest( 'button' )! );
		fireEvent.click(
			screen.getByText( /^(Finder|File Explorer|File manager)$/ ).closest( 'button' )!
		);
		fireEvent.click( screen.getByText( 'Zed' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Terminal' ).closest( 'button' )! );

		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/about/' );
		expect( openSiteFolder ).toHaveBeenCalledWith( 'site-1' );
		expect( openSiteInEditor ).toHaveBeenCalledWith( 'site-1' );
		expect( openSiteInTerminal ).toHaveBeenCalledWith( 'site-1' );
		expect( startSite ).not.toHaveBeenCalled();
	} );

	it( 'reports terminal failures and tells the user', async () => {
		const error = new Error( 'Terminal unavailable' );
		openSiteInTerminal.mockRejectedValueOnce( error );
		const consoleErrorMock = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		render( <OpenInMenu site={ createSite( { running: true } ) } /> );

		fireEvent.click( screen.getByText( 'Terminal' ).closest( 'button' )! );

		await waitFor( () => expect( captureException ).toHaveBeenCalledWith( error ) );
		expect( consoleErrorMock ).toHaveBeenCalledWith( 'Failed to open site in terminal:', error );
		expect( toast.error ).toHaveBeenCalledWith( 'Could not open the terminal.' );
	} );

	it( 'offers the browser destination only when a path is provided', () => {
		const { rerender } = render( <OpenInMenu site={ createSite( { running: true } ) } /> );
		expect( screen.queryByText( 'Browser' ) ).not.toBeInTheDocument();

		rerender( <OpenInMenu site={ createSite( { running: true } ) } browserPath="/about/" /> );

		fireEvent.click( screen.getByText( 'Browser' ).closest( 'button' )! );

		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/about/' );
		expect( window.localStorage.getItem( 'studio:open-in-menu:last-used:site-1' ) ).toBe(
			'browser'
		);
	} );

	it( 'disables the browser destination while the site is stopped', () => {
		render( <OpenInMenu site={ createSite( { running: false } ) } browserPath="/" /> );

		const browserItem = screen.getByText( 'Browser' ).closest( 'button' )!;
		expect( browserItem ).toBeDisabled();
	} );

	it( 'records Tracks events for browser and folder only', () => {
		render( <OpenInMenu site={ createSite( { running: true } ) } browserPath="/" /> );

		fireEvent.click( screen.getByText( 'Browser' ).closest( 'button' )! );
		fireEvent.click(
			screen.getByText( /^(Finder|File Explorer|File manager)$/ ).closest( 'button' )!
		);
		fireEvent.click( screen.getByText( 'Zed' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Terminal' ).closest( 'button' )! );

		expect( trackEvent ).toHaveBeenCalledWith( 'studio_site_open_in_browser', {
			browser: 'external',
		} );
		expect( trackEvent ).toHaveBeenCalledWith( 'studio_site_open_folder' );
		expect( trackEvent ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'records the browser event matching the active preview realm', () => {
		render(
			<OpenInMenu site={ createSite( { running: true } ) } browserPath="/wp-admin/plugins.php" />
		);

		fireEvent.click( screen.getByText( 'Browser' ).closest( 'button' )! );

		expect( trackEvent ).toHaveBeenCalledWith( 'studio_site_open_wp_admin', {
			browser: 'external',
		} );
	} );

	it( 'offers no phpMyAdmin destination', () => {
		render( <OpenInMenu site={ createSite( { running: true } ) } browserPath="/" /> );

		expect( screen.queryByText( 'phpMyAdmin' ) ).not.toBeInTheDocument();
	} );

	it( 'sends the user to settings when no editor is configured', () => {
		useUserPreferencesMock.mockReturnValue( { data: undefined } );

		render( <OpenInMenu site={ createSite( { running: true } ) } /> );

		fireEvent.click( screen.getByText( 'Editor' ).closest( 'button' )! );

		expect( navigateMock ).toHaveBeenCalledWith( { to: '/settings' } );
		expect( openSiteInEditor ).not.toHaveBeenCalled();
		// Nothing was opened, so the trigger's last-used destination stays put.
		expect( window.localStorage.getItem( 'studio:open-in-menu:last-used:site-1' ) ).toBeNull();
	} );

	it( 'remembers the last opened destination for the trigger icon', () => {
		render( <OpenInMenu site={ createSite( { running: true } ) } /> );

		fireEvent.click( screen.getByText( 'Terminal' ).closest( 'button' )! );

		expect( window.localStorage.getItem( 'studio:open-in-menu:last-used:site-1' ) ).toBe(
			'terminal'
		);
	} );

	it( 'runs the last used destination from the split action button', () => {
		render( <OpenInMenu site={ createSite( { running: true } ) } browserPath="/" /> );

		// Defaults to the browser before anything has been opened.
		fireEvent.click( screen.getByRole( 'button', { name: /^Open in / } ) );
		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/' );

		fireEvent.click( screen.getByText( 'Terminal' ).closest( 'button' )! );
		fireEvent.click( screen.getByRole( 'button', { name: 'Open in Terminal' } ) );
		expect( openSiteInTerminal ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'remembers destinations per site', async () => {
		const { rerender } = render(
			<OpenInMenu site={ createSite( { id: 'site-1', running: true } ) } browserPath="/" />
		);
		fireEvent.click( screen.getByText( 'Terminal' ).closest( 'button' )! );

		rerender(
			<OpenInMenu site={ createSite( { id: 'site-2', running: true } ) } browserPath="/" />
		);
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Open in Browser' } ) ).toBeVisible()
		);

		expect( window.localStorage.getItem( 'studio:open-in-menu:last-used:site-1' ) ).toBe(
			'terminal'
		);
		expect( window.localStorage.getItem( 'studio:open-in-menu:last-used:site-2' ) ).toBeNull();
	} );

	it( 'routes the manage actions through existing APIs', () => {
		render( <OpenInMenu site={ createSite( { running: true } ) } /> );

		fireEvent.click( screen.getByText( 'Duplicate' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Export entire site' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Export database' ).closest( 'button' )! );

		expect( copySite ).toHaveBeenCalledWith( 'site-1' );
		expect( exportFullSite ).toHaveBeenCalledWith( 'site-1' );
		expect( exportDatabase ).toHaveBeenCalledWith( 'site-1' );
		// Manage actions are not "open in" destinations; the trigger icon stays.
		expect( window.localStorage.getItem( 'studio:open-in-menu:last-used:site-1' ) ).toBeNull();

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByText( 'Delete' ).closest( 'button' )! );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();
	} );
} );

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
