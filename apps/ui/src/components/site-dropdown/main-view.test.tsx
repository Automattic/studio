import { useIsMutating } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Menu from '@/components/menu';
import { MainView } from './main-view';
import type { SiteDetails, Snapshot, SyncSite } from '@/data/core';
import type { SyncActivity } from '@/data/sync-activity';

const {
	connector,
	snapshots,
	connectedSites,
	publishPreviewMutate,
	transitions,
	startSiteMutate,
	stopSiteMutate,
} = vi.hoisted( () => ( {
	connector: {
		copyText: vi.fn(),
		openExternalUrl: vi.fn(),
	},
	snapshots: [] as Snapshot[],
	connectedSites: [] as SyncSite[],
	publishPreviewMutate: vi.fn(),
	transitions: { starting: false, stopping: false },
	startSiteMutate: vi.fn(),
	stopSiteMutate: vi.fn(),
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
	usePublishPreviewSite: () => ( { isPending: false, mutate: publishPreviewMutate } ),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useIsSiteBusy: () => transitions.starting || transitions.stopping,
	useIsSiteStarting: () => transitions.starting,
	useIsSiteStopping: () => transitions.stopping,
	useSiteOperation: () => null,
	useStartSite: () => ( { mutate: startSiteMutate } ),
	useStopSite: () => ( { mutate: stopSiteMutate } ),
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

const liveSite: SyncSite = {
	id: 123,
	localSiteId: 'site-1',
	name: 'Live Site',
	url: 'example.com',
	isStaging: false,
	isPressable: false,
	syncSupport: 'already-connected',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
};

const site: SiteDetails = {
	id: 'site-1',
	name: 'Demo Site',
	path: '/tmp/demo-site',
	port: 8881,
	running: true,
	phpVersion: '8.3',
};

function renderMainView( {
	siteOverrides = {},
	activity = null,
}: {
	siteOverrides?: Partial< SiteDetails >;
	activity?: SyncActivity | null;
} = {} ) {
	// The live row's "more" submenu needs the Menu.Root + Popup contexts the
	// dropdown provides around MainView in the real app.
	return render(
		<Menu.Root open>
			<Menu.Popup>
				<MainView
					site={ { ...site, ...siteOverrides } }
					activity={ activity }
					onSetupClick={ vi.fn() }
					onDisconnectClick={ vi.fn() }
					onPullClick={ vi.fn() }
					onPushClick={ vi.fn() }
				/>
			</Menu.Popup>
		</Menu.Root>
	);
}

describe( 'MainView', () => {
	beforeEach( () => {
		vi.mocked( useIsMutating ).mockImplementation( () => 0 );
		connector.copyText.mockReset();
		connector.openExternalUrl.mockReset();
		publishPreviewMutate.mockReset();
		startSiteMutate.mockReset();
		stopSiteMutate.mockReset();
		transitions.starting = false;
		transitions.stopping = false;
		snapshots.splice( 0, snapshots.length, {
			url: 'preview.example.com',
			atomicSiteId: 123,
			localSiteId: site.id,
			date: Date.now(),
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

	it( 'labels the site status toggle with the status and the action it performs', () => {
		const { unmount } = renderMainView();

		const running = screen.getByRole( 'switch', { name: 'Site status: Running. Stop site' } );
		expect( running ).toBeChecked();
		fireEvent.click( running );
		expect( stopSiteMutate ).toHaveBeenCalledWith( site.id );

		unmount();
		renderMainView( { siteOverrides: { running: false } } );

		const stopped = screen.getByRole( 'switch', { name: 'Site status: Stopped. Start site' } );
		expect( stopped ).not.toBeChecked();
		fireEvent.click( stopped );
		expect( startSiteMutate ).toHaveBeenCalledWith( site.id );
	} );

	it( 'reports the pending status on the site status toggle without acting on clicks', () => {
		transitions.starting = true;

		const { unmount } = renderMainView( { siteOverrides: { running: false } } );

		const starting = screen.getByRole( 'switch', { name: 'Site status: Starting' } );
		expect( starting ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( starting ).toBeChecked();
		fireEvent.click( starting );
		expect( startSiteMutate ).not.toHaveBeenCalled();

		unmount();
		transitions.starting = false;
		transitions.stopping = true;
		renderMainView();

		const stopping = screen.getByRole( 'switch', { name: 'Site status: Stopping' } );
		expect( stopping ).not.toBeChecked();
		fireEvent.click( stopping );
		expect( stopSiteMutate ).not.toHaveBeenCalled();
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

	it( 'shows detailed pull progress in the open site status', () => {
		renderMainView( {
			activity: {
				kind: 'pending',
				direction: 'pull',
				message: 'Creating remote backup… (24%)',
				progress: 24,
			},
		} );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Pulling from live…' );
		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Creating remote backup… (24%)' );
	} );

	it( 'updates the existing preview site while the snapshot is fresh', () => {
		renderMainView();

		fireEvent.click( screen.getByRole( 'button', { name: 'Update preview site' } ) );

		expect( publishPreviewMutate ).toHaveBeenCalledWith(
			expect.objectContaining( {
				siteId: site.id,
				existingHostname: 'preview.example.com',
			} ),
			expect.anything()
		);
	} );

	it( 'offers to share a new preview once the snapshot expired', () => {
		snapshots[ 0 ].date = Date.now() - 8 * 24 * 60 * 60 * 1000;

		renderMainView();

		expect( screen.getByText( 'The previous preview has expired.' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Copy preview URL' } ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Share a new one' } ) );

		expect( publishPreviewMutate ).toHaveBeenCalledWith(
			expect.objectContaining( {
				siteId: site.id,
				existingHostname: undefined,
			} ),
			expect.anything()
		);
	} );

	it( 'labels the live sync controls with plain actions while idle', () => {
		connectedSites.splice( 0, connectedSites.length, liveSite );

		renderMainView();

		const pullButton = screen.getByRole( 'button', { name: 'Pull from live' } );
		expect( pullButton.getAttribute( 'aria-disabled' ) ).not.toBe( 'true' );
		expect( screen.getByRole( 'button', { name: 'Push to live' } ) ).toBeInTheDocument();
	} );

	it( 'reflects an in-flight pull on both live sync controls', () => {
		vi.mocked( useIsMutating ).mockImplementation( ( filters ) =>
			filters?.mutationKey?.[ 0 ] === 'pull-site-from-live' ? 1 : 0
		);
		connectedSites.splice( 0, connectedSites.length, liveSite );

		renderMainView();

		const pullButton = screen.getByRole( 'button', { name: 'Pulling from live…' } );
		expect( pullButton ).toHaveAttribute( 'aria-disabled', 'true' );

		const pushButton = screen.getByRole( 'button', { name: 'Push to live (sync in progress)' } );
		expect( pushButton ).toHaveAttribute( 'aria-disabled', 'true' );

		expect(
			screen.getByRole( 'button', { name: 'Update preview site (sync in progress)' } )
		).toBeInTheDocument();
	} );
} );
