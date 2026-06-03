import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
import { usePullSiteFromLive, usePushSiteToLive } from '@/data/queries/use-sync-site';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { SessionUIProvider, useSessionPreviewUI } from '@/hooks/use-session-ui';
import { MainView } from './main-view';
import type { SiteDetails, WpAdminOpenTarget } from '@/data/core';

const navigateMock = vi.fn();

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigateMock,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-connected-wpcom-sites', () => ( {
	useConnectedWpcomSites: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-preview-site', () => ( {
	usePublishPreviewSite: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
	useStartSite: vi.fn(),
	useStopSite: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-snapshots', () => ( {
	useSnapshots: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sync-site', () => ( {
	PULL_FROM_LIVE_MUTATION_KEY: [ 'pull-site-from-live' ],
	PUSH_TO_LIVE_MUTATION_KEY: [ 'push-site-to-live' ],
	usePullSiteFromLive: vi.fn(),
	usePushSiteToLive: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useSaveUserPreferences: vi.fn(),
	useUserPreferences: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useConnectedWpcomSitesMock = vi.mocked( useConnectedWpcomSites );
const usePublishPreviewSiteMock = vi.mocked( usePublishPreviewSite );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useStartSiteMock = vi.mocked( useStartSite );
const useStopSiteMock = vi.mocked( useStopSite );
const useSnapshotsMock = vi.mocked( useSnapshots );
const usePullSiteFromLiveMock = vi.mocked( usePullSiteFromLive );
const usePushSiteToLiveMock = vi.mocked( usePushSiteToLive );
const useSaveUserPreferencesMock = vi.mocked( useSaveUserPreferences );
const useUserPreferencesMock = vi.mocked( useUserPreferences );

describe( 'MainView', () => {
	const openSiteUrl = vi.fn();
	const openExternalUrl = vi.fn();
	const saveUserPreferences = vi.fn();
	const startSiteMutate = vi.fn();
	const stopSiteMutate = vi.fn();
	let wpAdminOpenTarget: WpAdminOpenTarget;

	afterEach( () => {
		cleanup();
	} );

	beforeEach( () => {
		vi.clearAllMocks();
		wpAdminOpenTarget = 'default-browser';
		navigateMock.mockResolvedValue( undefined );
		openSiteUrl.mockResolvedValue( undefined );
		openExternalUrl.mockResolvedValue( undefined );
		saveUserPreferences.mockReset();
		startSiteMutate.mockReset();
		stopSiteMutate.mockReset();
		useConnectorMock.mockReturnValue( {
			openExternalUrl,
			openSiteUrl,
			openSiteFolder: vi.fn().mockResolvedValue( undefined ),
			openSiteInEditor: vi.fn().mockResolvedValue( undefined ),
			openSiteInTerminal: vi.fn().mockResolvedValue( undefined ),
		} as never );
		useConnectedWpcomSitesMock.mockReturnValue( {
			data: [ { id: 123, url: 'example.com', isStaging: false } ],
		} as never );
		usePublishPreviewSiteMock.mockReturnValue( { isPending: false, mutate: vi.fn() } as never );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
		useStartSiteMock.mockReturnValue( { mutate: startSiteMutate } as never );
		useStopSiteMock.mockReturnValue( { mutate: stopSiteMutate } as never );
		useSnapshotsMock.mockReturnValue( {
			data: [
				{
					localSiteId: 'site-1',
					url: 'demo-preview.wp.build',
					date: 1,
				},
			],
		} as never );
		usePullSiteFromLiveMock.mockReturnValue( { mutate: vi.fn() } as never );
		usePushSiteToLiveMock.mockReturnValue( { mutate: vi.fn() } as never );
		useSaveUserPreferencesMock.mockReturnValue( { mutate: saveUserPreferences } as never );
		useUserPreferencesMock.mockImplementation(
			() =>
				( {
					data: {
						editor: 'cursor',
						terminal: 'terminal',
						colorScheme: 'system',
						messageSendShortcut: 'mod-enter',
						wpAdminOpenTarget,
						locale: undefined,
					},
				} ) as never
		);
	} );

	it( 'groups site tools and WordPress admin destinations into flyout menus', async () => {
		renderMainView();

		expect( screen.getByText( 'Local' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Live' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Local site' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Live site' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Preview' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Preview site' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Share a link with others' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Open preview' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'demo-preview.wp.build' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Not yet created' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Pull from live' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Push to live' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Disconnect live site' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Update' } ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Open local site in your browser' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Open live site in your browser' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Open preview site in your browser' } ) );
		expect( openExternalUrl ).toHaveBeenCalledWith( 'http://localhost:8881' );
		expect( openExternalUrl ).toHaveBeenCalledWith( 'https://example.com' );
		expect( openExternalUrl ).toHaveBeenCalledWith( 'https://demo-preview.wp.build' );
		expect( screen.queryByText( 'Pull' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Push' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Disconnect' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'WP Admin' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Open in…' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Open folder' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Open WP admin' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'menuitem', { name: 'WP Admin' } ) );

		expect( await screen.findByText( 'Styles' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Navigation' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Templates' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Pages' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Posts' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Open in default browser' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Open in Studio browser' ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Styles' } ) );

		await waitFor( () => {
			expect( openSiteUrl ).toHaveBeenCalledWith(
				'site-1',
				'/wp-admin/site-editor.php?path=%2Fwp_global_styles'
			);
		} );
	} );

	it( 'opens WP Admin destinations in the Studio browser when selected', async () => {
		wpAdminOpenTarget = 'studio-browser';
		renderMainView();

		fireEvent.click( screen.getByRole( 'menuitem', { name: 'WP Admin' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Styles' } ) );

		await waitFor( () => {
			expect( screen.getByTestId( 'studio-browser-state' ) ).toHaveTextContent(
				'open:/studio-auto-login?redirect_to=%2Fwp-admin%2Fsite-editor.php%3Fpath%3D%252Fwp_global_styles'
			);
		} );
		expect( openSiteUrl ).not.toHaveBeenCalled();
	} );

	it( 'saves the selected WP Admin browser target', async () => {
		renderMainView();

		fireEvent.click( screen.getByRole( 'menuitem', { name: 'WP Admin' } ) );
		fireEvent.click(
			await screen.findByRole( 'menuitemradio', { name: 'Open in Studio browser' } )
		);

		expect( saveUserPreferences ).toHaveBeenCalledWith( {
			wpAdminOpenTarget: 'studio-browser',
		} );
	} );

	it( 'opens site settings from the menu when available', () => {
		const onSettingsClick = vi.fn();
		renderMainView( {}, { onSettingsClick } );

		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Site settings' } ) );

		expect( onSettingsClick ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'labels the first Open in item as Finder on macOS', async () => {
		const platformSpy = vi
			.spyOn( window.navigator, 'platform', 'get' )
			.mockReturnValue( 'MacIntel' );

		try {
			renderMainView();

			fireEvent.click( screen.getByRole( 'menuitem', { name: 'Open in…' } ) );

			await screen.findByRole( 'menuitem', { name: 'Finder' } );
			expect( screen.queryByRole( 'menuitem', { name: 'Folder' } ) ).not.toBeInTheDocument();
		} finally {
			platformSpy.mockRestore();
		}
	} );

	it( 'stops the local server from the stateful icon button', () => {
		renderMainView();

		fireEvent.click( screen.getByRole( 'button', { name: 'Stop local site' } ) );
		expect( stopSiteMutate ).toHaveBeenCalledWith( 'site-1' );
	} );

	it( 'starts the local server from the stateful icon button', () => {
		renderMainView( { running: false } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Start local site' } ) );
		expect( startSiteMutate ).toHaveBeenCalledWith( 'site-1' );
	} );

	it( 'shows a busy local server button while the server is transitioning', () => {
		useIsSiteStartingMock.mockReturnValue( true );

		renderMainView( { running: false } );

		const button = screen.getByRole( 'button', { name: 'Starting local site' } );
		expect( button ).toHaveAttribute( 'aria-busy', 'true' );

		fireEvent.click( button );
		expect( startSiteMutate ).not.toHaveBeenCalled();
		expect( stopSiteMutate ).not.toHaveBeenCalled();
	} );
} );

function StudioBrowserStatus() {
	const preview = useSessionPreviewUI();
	return (
		<span data-testid="studio-browser-state">
			{ `${ preview.open ? 'open' : 'closed' }:${ preview.path }` }
		</span>
	);
}

function renderMainView(
	siteOverrides: Partial< SiteDetails > = {},
	options: { onSettingsClick?: () => void } = {}
) {
	const queryClient = new QueryClient( {
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	} );

	return render(
		<QueryClientProvider client={ queryClient }>
			<SessionUIProvider>
				<Menu.Root modal={ false } open>
					<Menu.Trigger render={ <button type="button">Site menu</button> } />
					<Menu.Popup>
						<MainView
							site={ {
								id: 'site-1',
								name: 'Demo Site',
								path: '/Users/example/Studio/demo-site',
								port: 8881,
								running: true,
								phpVersion: '8.3',
								...siteOverrides,
							} }
							onSetupClick={ vi.fn() }
							onDisconnectClick={ vi.fn() }
							onSettingsClick={ options.onSettingsClick }
						/>
					</Menu.Popup>
				</Menu.Root>
				<StudioBrowserStatus />
			</SessionUIProvider>
		</QueryClientProvider>
	);
}
