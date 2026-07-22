import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MainView } from './main-view';
import type { SiteDetails, Snapshot, SyncSite } from '@/data/core';

const { connector, snapshots, connectedSites } = vi.hoisted( () => ( {
	connector: {
		copyText: vi.fn(),
		openExternalUrl: vi.fn(),
		getLiveSyncItems: vi.fn(),
		getLiveSyncLatestBackupTime: vi.fn(),
	},
	snapshots: [] as Snapshot[],
	connectedSites: [] as SyncSite[],
} ) );

vi.mock( '@tanstack/react-query', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@tanstack/react-query') >();
	return {
		...actual,
		useIsMutating: vi.fn( () => 0 ),
	};
} );

vi.mock( '@/data/core', () => ( {
	useConnector: () => connector,
} ) );

vi.mock( '@/data/queries/use-connected-wpcom-sites', () => ( {
	useConnectedWpcomSites: () => ( { data: connectedSites } ),
} ) );

vi.mock( '@/data/queries/use-agentic-features', () => ( {
	useAgenticFeatures: vi.fn( () => ( { enabled: true, reason: null, isReady: true } ) ),
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useLogin: () => ( { mutate: vi.fn(), isPending: false } ),
} ) );

vi.mock( '@/data/queries/use-preview-site', () => ( {
	usePublishPreviewSite: () => ( { isPending: false, mutate: vi.fn() } ),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useIsSiteStarting: () => false,
	useIsSiteStopping: () => false,
	useStartSite: () => ( { mutate: vi.fn() } ),
	useStopSite: () => ( { mutate: vi.fn() } ),
} ) );

vi.mock( '@/data/queries/use-snapshots', () => ( {
	useSnapshots: () => ( { data: snapshots } ),
} ) );

vi.mock( '@/data/queries/use-sync-site', () => ( {
	PULL_FROM_LIVE_MUTATION_KEY: [ 'pull-site-from-live' ],
	PUSH_TO_LIVE_MUTATION_KEY: [ 'push-site-to-live' ],
	usePullSiteFromLive: () => ( { mutate: vi.fn() } ),
	usePushSiteToLive: () => ( { mutate: vi.fn() } ),
} ) );

const site: SiteDetails = {
	id: 'site-1',
	name: 'Demo Site',
	path: '/tmp/demo-site',
	port: 8881,
	running: true,
	phpVersion: '8.3',
};

function renderMainView(
	props: { onDisconnectClick?: () => void; siteOverrides?: Partial< SiteDetails > } = {}
) {
	const queryClient = new QueryClient();
	return render(
		<QueryClientProvider client={ queryClient }>
			<MainView
				site={ { ...site, ...props.siteOverrides } }
				activity={ null }
				lastSyncLog={ null }
				onSetupClick={ vi.fn() }
				onDisconnectClick={ props.onDisconnectClick ?? vi.fn() }
			/>
		</QueryClientProvider>
	);
}

describe( 'MainView', () => {
	beforeEach( () => {
		connector.copyText.mockReset();
		connector.openExternalUrl.mockReset();
		connector.getLiveSyncItems.mockReset();
		connector.getLiveSyncItems.mockResolvedValue( { source: 'local', themes: [], plugins: [] } );
		connector.getLiveSyncLatestBackupTime.mockReset();
		connector.getLiveSyncLatestBackupTime.mockResolvedValue( null );
		snapshots.splice( 0, snapshots.length, {
			url: 'preview.example.com',
			atomicSiteId: 123,
			localSiteId: site.id,
			date: 1,
		} );
		connectedSites.splice( 0, connectedSites.length );
	} );

	it( 'shows an Xdebug badge on the Studio row only when Xdebug is enabled', () => {
		const { unmount } = renderMainView( { siteOverrides: { enableXdebug: true } } );

		expect( screen.getByRole( 'img', { name: 'Xdebug enabled' } ) ).toBeInTheDocument();

		unmount();
		renderMainView();

		expect( screen.queryByRole( 'img', { name: 'Xdebug enabled' } ) ).not.toBeInTheDocument();
	} );

	it( 'handles preview URL copy failures', async () => {
		const error = new Error( 'Clipboard denied' );
		const consoleError = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		connector.copyText.mockRejectedValueOnce( error );

		renderMainView();

		fireEvent.click( screen.getByRole( 'button', { name: 'Copy preview URL' } ) );

		await waitFor( () => {
			expect( connector.copyText ).toHaveBeenCalledWith( 'https://preview.example.com' );
			expect( consoleError ).toHaveBeenCalledWith( 'Failed to copy preview URL:', error );
		} );

		consoleError.mockRestore();
	} );

	it( 'shows disconnect at the bottom of the sync flyout', () => {
		const onDisconnectClick = vi.fn();
		connectedSites.splice( 0, connectedSites.length, {
			id: 123,
			name: 'Live Site',
			url: 'https://example.com',
			localSiteId: site.id,
			isStaging: false,
			isPressable: false,
			syncSupport: 'already-connected',
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		} );

		renderMainView( { onDisconnectClick } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Sync' } ) );

		expect(
			screen.queryByRole( 'button', { name: 'More live site actions' } )
		).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Disconnect' } ) );

		expect( onDisconnectClick ).toHaveBeenCalledTimes( 1 );
	} );
} );
