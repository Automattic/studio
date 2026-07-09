import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import {
	useCopySite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteStarting,
	useIsSiteStopping,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { usePluginSiteTag } from '@/lib/plugin-prototype';
import { SiteContextMenu } from './index';
import type { SiteDetails } from '@/data/core';
import type { ReactElement, ReactNode } from 'react';

const navigateMock = vi.fn();
const paramsMock = vi.fn( () => ( {} ) );

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigateMock,
	useParams: () => paramsMock(),
} ) );

vi.mock( '@wordpress/ui', () => ( {
	Button: () => null,
	Tooltip: {
		Root: ( { children }: { children: ReactNode } ) => <>{ children }</>,
		Trigger: () => null,
		Positioner: () => null,
		Popup: () => null,
	},
} ) );

vi.mock( '@/components/menu', () => ( {
	ContextMenuRoot: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	ContextMenuTrigger: ( { render: renderProp }: { render: ReactElement } ) => renderProp,
	ContextPopup: ( { children }: { children: ReactNode } ) => <div role="menu">{ children }</div>,
	Popup: ( { children }: { children: ReactNode } ) => <div role="menu">{ children }</div>,
	SubmenuRoot: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	SubmenuTrigger: ( { children }: { children: ReactNode } ) => (
		<button type="button">{ children }</button>
	),
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
	DeleteSiteDialog: ( { open, onDeleted }: { open: boolean; onDeleted?: () => void } ) =>
		open ? (
			<div role="dialog">
				<button type="button" onClick={ onDeleted }>
					Confirm delete
				</button>
			</div>
		) : null,
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
	useStopSite: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@/lib/plugin-prototype', () => ( {
	usePluginSiteTag: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const useCopySiteMock = vi.mocked( useCopySite, { partial: true } );
const useExportDatabaseMock = vi.mocked( useExportDatabase, { partial: true } );
const useExportFullSiteMock = vi.mocked( useExportFullSite, { partial: true } );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useStartSiteMock = vi.mocked( useStartSite, { partial: true } );
const useStopSiteMock = vi.mocked( useStopSite, { partial: true } );
const useUserPreferencesMock = vi.mocked( useUserPreferences, { partial: true } );
const usePluginSiteTagMock = vi.mocked( usePluginSiteTag );

describe( 'SiteContextMenu', () => {
	const openSiteUrl = vi.fn().mockResolvedValue( undefined );
	const openSiteInEditor = vi.fn().mockResolvedValue( undefined );
	const openExternalUrl = vi.fn().mockResolvedValue( undefined );
	const startSite = vi.fn().mockResolvedValue( undefined );
	const stopSite = vi.fn();
	const copySite = vi.fn();
	const exportFullSite = vi.fn();
	const exportDatabase = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		paramsMock.mockReturnValue( {} );
		useConnectorMock.mockReturnValue( { openSiteUrl, openSiteInEditor, openExternalUrl } );
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
		useStopSiteMock.mockReturnValue( { isPending: false, mutate: stopSite } );
		useUserPreferencesMock.mockReturnValue( { data: undefined } );
		usePluginSiteTagMock.mockReturnValue( undefined );
	} );

	function renderMenu( site: SiteDetails ) {
		return render( <SiteContextMenu site={ site } trigger={ <section>Row</section> } /> );
	}

	it( 'renders the row element as the menu trigger', () => {
		renderMenu( createSite() );

		expect( screen.getByText( 'Row' ) ).toBeVisible();
	} );

	it( 'starts a stopped site and stops a running one', () => {
		const { unmount } = renderMenu( createSite( { running: false } ) );

		fireEvent.click( screen.getByText( 'Start site' ) );
		expect( startSite ).toHaveBeenCalledWith( 'site-1' );
		expect( screen.queryByText( 'Stop site' ) ).not.toBeInTheDocument();
		unmount();

		renderMenu( createSite( { running: true } ) );
		fireEvent.click( screen.getByText( 'Stop site' ) );
		expect( stopSite ).toHaveBeenCalledWith( 'site-1' );
	} );

	it( 'disables start/stop while the site is transitioning', () => {
		useIsSiteStartingMock.mockReturnValue( true );

		renderMenu( createSite( { running: false } ) );

		expect( screen.getByText( 'Start site' ).closest( 'button' ) ).toBeDisabled();
	} );

	it( 'opens WordPress destinations for a block theme', async () => {
		renderMenu( createSite( { running: true } ) );

		expect( screen.getByText( 'Site Editor' ) ).toBeVisible();
		expect( screen.queryByText( 'Customizer' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByText( 'WP Admin' ).closest( 'button' )! );
		await waitFor( () => expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/' ) );
	} );

	it( 'shows plugin destinations for a plugin-tagged site', () => {
		usePluginSiteTagMock.mockReturnValue( {
			siteId: 'site-1',
			slug: 'my-plugin',
			source: 'new',
		} );

		renderMenu( createSite( { running: true } ) );

		expect( screen.getByText( 'Plugins' ) ).toBeVisible();
		expect( screen.getByText( 'Site Health' ) ).toBeVisible();
		expect( screen.queryByText( 'Site Editor' ) ).not.toBeInTheDocument();
	} );

	it( 'offers Browser in Open in and opens the running site externally', () => {
		renderMenu( createSite( { running: true } ) );

		fireEvent.click( screen.getByText( 'Browser' ).closest( 'button' )! );

		expect( openExternalUrl ).toHaveBeenCalledWith( 'http://localhost:8881' );
	} );

	it( 'sends the user to settings when no editor is configured', () => {
		renderMenu( createSite( { running: true } ) );

		fireEvent.click( screen.getByText( 'Editor' ).closest( 'button' )! );

		expect( navigateMock ).toHaveBeenCalledWith( { to: '/settings' } );
		expect( openSiteInEditor ).not.toHaveBeenCalled();
	} );

	it( 'routes the manage actions through existing APIs', () => {
		renderMenu( createSite( { running: true } ) );

		fireEvent.click( screen.getByText( 'Duplicate' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Export' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Export DB' ).closest( 'button' )! );

		expect( copySite ).toHaveBeenCalledWith( 'site-1' );
		expect( exportFullSite ).toHaveBeenCalledWith( 'site-1' );
		expect( exportDatabase ).toHaveBeenCalledWith( 'site-1' );
	} );

	it( 'opens the delete dialog and only navigates away for the active site', () => {
		paramsMock.mockReturnValue( { siteId: 'other-site' } );

		const { unmount } = renderMenu( createSite() );
		fireEvent.click( screen.getByText( 'Delete' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Confirm delete' ) );
		expect( navigateMock ).not.toHaveBeenCalled();
		unmount();

		paramsMock.mockReturnValue( { siteId: 'site-1' } );
		renderMenu( createSite() );
		fireEvent.click( screen.getByText( 'Delete' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Confirm delete' ) );
		expect( navigateMock ).toHaveBeenCalledWith( { to: '/' } );
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
		themeDetails: {
			name: 'Twenty Twenty-Six',
			path: '/wp-content/themes/twentytwentysix',
			slug: 'twentytwentysix',
			isBlockTheme: true,
		},
		...overrides,
	};
}
