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

let snapshotUsage: {
	siteCount: number;
	siteLimit: number;
	siteCreationBlocked: boolean;
} | null = null;

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
	useSnapshotUsage: () => ( { data: snapshotUsage } ),
} ) );

const cancelSyncMutate = vi.fn();

vi.mock( '@/data/queries/use-sync-site', () => ( {
	PULL_FROM_LIVE_MUTATION_KEY: [ 'pull-site-from-live' ],
	PUSH_TO_LIVE_MUTATION_KEY: [ 'push-site-to-live' ],
	usePullSiteFromLive: () => ( { mutate: vi.fn() } ),
	usePushSiteToLive: () => ( { mutate: vi.fn() } ),
	useCancelSync: () => ( { mutate: cancelSyncMutate } ),
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
		cancelSyncMutate.mockReset();
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
		snapshotUsage = null;
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

	it.each( [
		[ 'pull', 'Pulling from live…' ],
		[ 'import', 'Importing backup…' ],
	] as const )( 'shows detailed %s progress in the open site status', ( direction, title ) => {
		renderMainView( {
			activity: { kind: 'pending', direction, message: '24% · Media uploads…' },
		} );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( title );
		expect( screen.getByRole( 'status' ) ).toHaveTextContent( '24% · Media uploads…' );
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

	it( 'offers to stop an in-flight push and reports the site being stopped', () => {
		vi.mocked( useIsMutating ).mockReturnValue( 1 );
		connectedSites.splice( 0, connectedSites.length, liveSite );

		renderMainView( {
			activity: { kind: 'pending', direction: 'push', phase: 'uploading' },
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel push' } ) );

		expect( cancelSyncMutate ).toHaveBeenCalledWith( {
			siteId: site.id,
			remoteSiteId: liveSite.id,
		} );
		expect( screen.getByRole( 'status' ) ).not.toHaveTextContent( 'can not be cancelled' );
	} );

	it( 'disables the Share button when the preview site limit is reached', () => {
		snapshots.splice( 0, snapshots.length );
		snapshotUsage = { siteCount: 10, siteLimit: 10, siteCreationBlocked: false };

		renderMainView();

		expect(
			screen.getByText( "You've used all 10 preview sites available on your account." )
		).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
	} );

	it( 'disables the Share button when preview site creation is blocked', () => {
		snapshots.splice( 0, snapshots.length );
		snapshotUsage = { siteCount: 0, siteLimit: 10, siteCreationBlocked: true };

		renderMainView();

		expect(
			screen.getByText( 'Preview sites are not available for your account.' )
		).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
	} );

	// The reason doubles as the accessible name and is stated in the panel: a
	// tooltip on a disabled control is a dead end.
	it.each( [
		[
			{ kind: 'pending', direction: 'push', phase: 'applyingChanges' },
			'Push can not be cancelled while applying changes to the remote site',
		],
		[
			{ kind: 'pending', direction: 'pull', action: 'import' },
			'Pull can not be cancelled while importing changes to your local site',
		],
	] as const )( 'stops offering to cancel past the point of no return', ( activity, reason ) => {
		vi.mocked( useIsMutating ).mockReturnValue( 1 );
		connectedSites.splice( 0, connectedSites.length, liveSite );

		renderMainView( { activity } );

		fireEvent.click( screen.getByRole( 'button', { name: reason } ) );
		expect( screen.getByRole( 'button', { name: reason } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getByRole( 'status' ) ).toHaveTextContent( reason );
		expect( cancelSyncMutate ).not.toHaveBeenCalled();
	} );

	// Whoever started the sync — this window, the agent or a terminal — the live
	// sync controls are busy; only a sync this window started offers a cancel.
	it.each( [
		[ 'push', 'Pushing to live…' ],
		[ 'pull', 'Pulling from live…' ],
		[ 'preview', 'Updating preview…' ],
		[ 'import', 'Push to live (sync in progress)' ],
	] as const )( 'keeps the live sync controls busy during a %s', ( direction, busyLabel ) => {
		connectedSites.splice( 0, connectedSites.length, liveSite );

		renderMainView( { activity: { kind: 'pending', direction } } );

		expect( screen.getByRole( 'button', { name: busyLabel } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.queryByRole( 'button', { name: /^Cancel / } ) ).not.toBeInTheDocument();
	} );
} );
