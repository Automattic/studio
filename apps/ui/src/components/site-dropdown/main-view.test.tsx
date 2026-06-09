import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
import { MainView } from './main-view';
import type { SiteDetails } from '@/data/core';

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

describe( 'MainView', () => {
	const openSiteUrl = vi.fn();
	const openExternalUrl = vi.fn();
	const publishPreviewMutate = vi.fn();
	const startSiteMutate = vi.fn();
	const stopSiteMutate = vi.fn();

	afterEach( () => {
		cleanup();
	} );

	beforeEach( () => {
		vi.clearAllMocks();
		openSiteUrl.mockResolvedValue( undefined );
		openExternalUrl.mockResolvedValue( undefined );
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
		usePublishPreviewSiteMock.mockReturnValue( {
			isPending: false,
			mutate: publishPreviewMutate,
		} as never );
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
	} );

	it( 'renders an environment-focused menu without general shortcut actions', () => {
		renderMainView();

		expect( screen.getByText( 'Local' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Stop' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Start local site' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Stop local site' } ) ).not.toBeInTheDocument();
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
		expect( screen.queryByText( 'Site settings' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'WP Admin' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Open in…' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Open folder' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Open WP admin' ) ).not.toBeInTheDocument();
		expect( openSiteUrl ).not.toHaveBeenCalled();
	} );

	it( 'starts and stops the local site with a simple text button', () => {
		renderMainView();

		fireEvent.click( screen.getByRole( 'button', { name: 'Stop' } ) );

		expect( stopSiteMutate ).toHaveBeenCalledWith( 'site-1' );
		expect( startSiteMutate ).not.toHaveBeenCalled();

		cleanup();

		renderMainView( { running: false } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Start' } ) );

		expect( startSiteMutate ).toHaveBeenCalledWith( 'site-1' );
	} );

	it( 'shows the local transition status and disables the local server button', () => {
		useIsSiteStartingMock.mockReturnValue( true );

		renderMainView( { running: false } );

		expect( screen.getByText( 'Starting…' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Start' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Start' } ) );

		expect( startSiteMutate ).not.toHaveBeenCalled();
		expect( stopSiteMutate ).not.toHaveBeenCalled();
	} );

	it( 'prompts users to publish to WordPress.com when there is no live site', () => {
		const onSetupClick = vi.fn();
		useConnectedWpcomSitesMock.mockReturnValue( { data: [] } as never );

		renderMainView( {}, { onSetupClick } );

		expect( screen.getByText( 'Launch on WordPress.com' ) ).toBeInTheDocument();
		expect(
			screen.getByText(
				'Make it available to visitors when you’re ready to share it with the world.'
			)
		).toBeInTheDocument();
		expect( screen.queryByText( 'Publish to go live.' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Not yet set up' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Live' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Live site' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Pull from live' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Push to live' } ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Disconnect live site' } )
		).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Publish' } ) );

		expect( onSetupClick ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'prompts users to create a preview when there is no preview site', () => {
		useSnapshotsMock.mockReturnValue( { data: [] } as never );

		renderMainView();

		expect( screen.getByText( 'Share a preview' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Send a temporary link for feedback before you launch.' )
		).toBeInTheDocument();
		expect( screen.queryByText( 'Share a link with others' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Create preview link' } )
		).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Share' } ) );

		expect( publishPreviewMutate ).toHaveBeenCalledWith(
			{ siteId: 'site-1', existingHostname: undefined },
			expect.any( Object )
		);
	} );
} );

function renderMainView(
	siteOverrides: Partial< SiteDetails > = {},
	options: { onSetupClick?: () => void } = {}
) {
	const queryClient = new QueryClient( {
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	} );

	return render(
		<QueryClientProvider client={ queryClient }>
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
						onSetupClick={ options.onSetupClick ?? vi.fn() }
						onDisconnectClick={ vi.fn() }
					/>
				</Menu.Popup>
			</Menu.Root>
		</QueryClientProvider>
	);
}
