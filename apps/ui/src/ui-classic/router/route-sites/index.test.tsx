import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import {
	useCopySite,
	useDeleteSite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
import {
	useDisconnectWpcomSite,
	usePullSiteFromLive,
	usePushSiteToLive,
} from '@/data/queries/use-sync-site';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { usePickableWpcomSites } from '@/data/queries/use-wpcom-sites';
import { SitesPage } from './index';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

const navigateMock = vi.fn();

vi.mock( '@tanstack/react-router', () => ( {
	Link: ( {
		to,
		params,
		className,
		children,
	}: {
		to: string;
		params?: { siteId?: string };
		className?: string;
		children: ReactNode;
	} ) => {
		const href = params?.siteId ? to.replace( '$siteId', params.siteId ) : to;
		return (
			<a href={ href } className={ className }>
				{ children }
			</a>
		);
	},
	useNavigate: () => navigateMock,
	createRoute: () => ( {} ),
} ) );

vi.mock( '../layout-dashboard', () => ( {
	dashboardLayoutRoute: {},
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-connected-wpcom-sites', () => ( {
	connectedWpcomSitesQueryKey: ( localSiteId: string ) => [ 'connected-wpcom-sites', localSiteId ],
	useConnectedWpcomSites: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-preview-site', () => ( {
	usePublishPreviewSite: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: vi.fn(),
	useStartSite: vi.fn(),
	useStopSite: vi.fn(),
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
	useCopySite: vi.fn(),
	useDeleteSite: vi.fn(),
	useExportFullSite: vi.fn(),
	useExportDatabase: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-snapshots', () => ( {
	useSnapshots: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sync-site', () => ( {
	PULL_FROM_LIVE_MUTATION_KEY: [ 'pullSiteFromLive' ],
	PUSH_TO_LIVE_MUTATION_KEY: [ 'pushSiteToLive' ],
	useDisconnectWpcomSite: vi.fn(),
	usePullSiteFromLive: vi.fn(),
	usePushSiteToLive: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-wpcom-sites', () => ( {
	usePickableWpcomSites: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useConnectedWpcomSitesMock = vi.mocked( useConnectedWpcomSites );
const usePublishPreviewSiteMock = vi.mocked( usePublishPreviewSite );
const useSitesMock = vi.mocked( useSites );
const useSnapshotsMock = vi.mocked( useSnapshots );
const useStartSiteMock = vi.mocked( useStartSite );
const useStopSiteMock = vi.mocked( useStopSite );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useCopySiteMock = vi.mocked( useCopySite );
const useDeleteSiteMock = vi.mocked( useDeleteSite );
const useExportFullSiteMock = vi.mocked( useExportFullSite );
const useExportDatabaseMock = vi.mocked( useExportDatabase );
const useDisconnectWpcomSiteMock = vi.mocked( useDisconnectWpcomSite );
const usePullSiteFromLiveMock = vi.mocked( usePullSiteFromLive );
const usePushSiteToLiveMock = vi.mocked( usePushSiteToLive );
const useUserPreferencesMock = vi.mocked( useUserPreferences );
const usePickableWpcomSitesMock = vi.mocked( usePickableWpcomSites );

describe( 'SitesPage', () => {
	const openSiteUrl = vi.fn();
	const openExternalUrl = vi.fn();
	const connectWpcomSite = vi.fn();
	const startSiteMutate = vi.fn();
	const stopSiteMutate = vi.fn();
	const publishPreviewMutate = vi.fn();
	const pullSiteMutate = vi.fn();
	const pushSiteMutate = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		navigateMock.mockResolvedValue( undefined );
		openSiteUrl.mockResolvedValue( undefined );
		openExternalUrl.mockResolvedValue( undefined );
		connectWpcomSite.mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			openSiteUrl,
			openExternalUrl,
			connectWpcomSite,
			getPublishCheckoutUrl: vi.fn().mockReturnValue( 'https://wordpress.com/setup' ),
			openSiteFolder: vi.fn().mockResolvedValue( undefined ),
			openSiteInEditor: vi.fn().mockResolvedValue( undefined ),
			openSiteInTerminal: vi.fn().mockResolvedValue( undefined ),
			isFullscreen: vi.fn().mockResolvedValue( false ),
			onFullscreenChange: vi.fn().mockReturnValue( vi.fn() ),
		} as never );
		useStartSiteMock.mockReturnValue( { mutate: startSiteMutate } as never );
		useStopSiteMock.mockReturnValue( { mutate: stopSiteMutate } as never );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
		usePublishPreviewSiteMock.mockReturnValue( {
			mutate: publishPreviewMutate,
			isPending: false,
		} as never );
		usePullSiteFromLiveMock.mockReturnValue( { mutate: pullSiteMutate } as never );
		usePushSiteToLiveMock.mockReturnValue( { mutate: pushSiteMutate } as never );
		useCopySiteMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useDeleteSiteMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useExportFullSiteMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useExportDatabaseMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useDisconnectWpcomSiteMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useUserPreferencesMock.mockReturnValue( {
			data: {
				editor: 'cursor',
				terminal: 'terminal',
				colorScheme: 'system',
				messageSendShortcut: 'mod-enter',
				wpAdminOpenTarget: 'default-browser',
				locale: undefined,
			},
		} as never );
		usePickableWpcomSitesMock.mockReturnValue( {
			data: [],
			isLoading: false,
			isFetching: false,
			error: null,
			refetch: vi.fn(),
		} as never );
	} );

	it( 'links cards to site overview and exposes primary site actions', async () => {
		mockSites( [ exampleSite() ] );
		useConnectedWpcomSitesMock.mockReturnValue( {
			data: [
				{
					id: 123,
					localSiteId: 'site-1',
					name: 'Live Site',
					url: 'live.example.com',
					isStaging: false,
					isPressable: false,
					syncSupport: 'already-connected',
					lastPullTimestamp: null,
					lastPushTimestamp: null,
				},
			],
		} as never );
		useSnapshotsMock.mockReturnValue( {
			data: [ { localSiteId: 'site-1', url: 'preview.wp.build', date: 100 } ],
		} as never );
		renderSitesPage();

		expect( screen.getByRole( 'link', { name: /Example Site/ } ) ).toHaveAttribute(
			'href',
			'/sites/site-1'
		);
		expect( screen.getByRole( 'button', { name: 'Stop' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Open site' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'WP Admin' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'link', { name: 'Settings' } ) ).toHaveAttribute(
			'href',
			'/sites/site-1/settings'
		);
		expect( screen.getByRole( 'button', { name: 'Pull from live' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Push to live' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Disconnect live site' } ) ).toBeInTheDocument();
		expect( screen.getByText( 'preview.wp.build' ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Stop' } ) );
		expect( stopSiteMutate ).toHaveBeenCalledWith( 'site-1' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Open site' } ) );
		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '', { autoLogin: false } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Pull from live' } ) );
		expect( pullSiteMutate ).toHaveBeenCalledWith( { siteId: 'site-1', remoteSiteId: 123 } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Push to live' } ) );
		expect( pushSiteMutate ).toHaveBeenCalledWith(
			{ siteId: 'site-1', remoteSiteId: 123 },
			expect.any( Object )
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Update' } ) );
		expect( publishPreviewMutate ).toHaveBeenCalledWith(
			{ siteId: 'site-1', existingHostname: 'preview.wp.build' },
			expect.any( Object )
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'WP Admin' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Pages' } ) );
		expect( openSiteUrl ).toHaveBeenCalledWith(
			'site-1',
			'/wp-admin/site-editor.php?path=%2Fpage',
			undefined
		);
	} );

	it( 'starts stopped sites and creates preview links', () => {
		mockSites( [ exampleSite( { running: false } ) ] );
		useConnectedWpcomSitesMock.mockReturnValue( { data: [] } as never );
		useSnapshotsMock.mockReturnValue( { data: [] } as never );

		renderSitesPage();

		fireEvent.click( screen.getByRole( 'button', { name: 'Start' } ) );
		expect( startSiteMutate ).toHaveBeenCalledWith( 'site-1' );
		expect( screen.getByRole( 'button', { name: 'Open site' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getByRole( 'button', { name: 'WP Admin' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
		expect( publishPreviewMutate ).toHaveBeenCalledWith(
			{ siteId: 'site-1', existingHostname: undefined },
			expect.any( Object )
		);
	} );

	it( 'connects a live WordPress.com site from the card dialog', async () => {
		mockSites( [ exampleSite() ] );
		useConnectedWpcomSitesMock.mockReturnValue( { data: [] } as never );
		useSnapshotsMock.mockReturnValue( { data: [] } as never );
		usePickableWpcomSitesMock.mockReturnValue( {
			data: [
				{
					id: 456,
					localSiteId: '',
					name: 'Candidate Site',
					url: 'candidate.example.com',
					isStaging: false,
					isPressable: false,
					syncSupport: 'syncable',
					lastPullTimestamp: null,
					lastPushTimestamp: null,
				},
			],
			isLoading: false,
			isFetching: false,
			error: null,
			refetch: vi.fn(),
		} as never );

		renderSitesPage();

		fireEvent.click( screen.getByRole( 'button', { name: 'Connect' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: /Candidate Site/ } ) );

		await waitFor( () => {
			expect( connectWpcomSite ).toHaveBeenCalledWith(
				'site-1',
				expect.objectContaining( {
					id: 456,
					localSiteId: 'site-1',
					syncSupport: 'already-connected',
				} )
			);
		} );
	} );

	it( 'searches and sorts the site list', () => {
		mockSites( [
			exampleSite( {
				id: 'site-1',
				name: 'Example Site',
				path: '/Users/example/Studio/example-site',
				running: true,
			} ),
			exampleSite( {
				id: 'site-2',
				name: 'Archive Site',
				path: '/Users/archive/Studio/archive-site',
				running: false,
			} ),
		] );
		useConnectedWpcomSitesMock.mockReturnValue( { data: [] } as never );
		useSnapshotsMock.mockReturnValue( { data: [] } as never );

		renderSitesPage();

		expect( screen.getAllByRole( 'listitem' )[ 0 ] ).toHaveTextContent( 'Archive Site' );

		fireEvent.change( screen.getByLabelText( 'Sort' ), {
			target: { value: 'status' },
		} );
		expect( screen.getAllByRole( 'listitem' )[ 0 ] ).toHaveTextContent( 'Example Site' );

		fireEvent.change( screen.getByRole( 'searchbox', { name: 'Search sites' } ), {
			target: { value: 'example' },
		} );
		fireEvent.submit( screen.getByRole( 'search', { name: 'Search sites' } ) );
		expect( screen.getByText( 'Example Site' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Archive Site' ) ).not.toBeInTheDocument();
	} );

	it( 'does not match hidden filesystem path segments', () => {
		mockSites( [
			exampleSite( {
				id: 'site-1',
				name: 'Example Site',
				path: '/Users/shaun/Studio/example-site',
			} ),
			exampleSite( {
				id: 'site-2',
				name: 'Archive Site',
				path: '/Users/shaun/Studio/archive-site',
				running: false,
			} ),
		] );
		useConnectedWpcomSitesMock.mockReturnValue( { data: [] } as never );
		useSnapshotsMock.mockReturnValue( { data: [] } as never );

		renderSitesPage();

		fireEvent.change( screen.getByRole( 'searchbox', { name: 'Search sites' } ), {
			target: { value: 'shaun' },
		} );

		expect( screen.queryByText( 'Example Site' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Archive Site' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'No sites match your search.' ) ).toBeInTheDocument();
	} );
} );

function renderSitesPage() {
	const queryClient = new QueryClient( {
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	} );

	return render(
		<QueryClientProvider client={ queryClient }>
			<SitesPage />
		</QueryClientProvider>
	);
}

function mockSites( sites: SiteDetails[] ) {
	useSitesMock.mockReturnValue( { data: sites, isLoading: false } as never );
}

function exampleSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	return {
		id: 'site-1',
		name: 'Example Site',
		path: '/Users/example/Studio/example-site',
		port: 8881,
		running: true,
		phpVersion: '8.3',
		siteIcon: null,
		...overrides,
	};
}
