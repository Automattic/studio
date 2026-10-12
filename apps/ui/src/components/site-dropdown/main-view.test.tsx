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
	deleteSnapshotMutate,
	renameSnapshotMutate,
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
	deleteSnapshotMutate: vi.fn(),
	renameSnapshotMutate: vi.fn(),
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

vi.mock( '@/data/queries/use-wpcom-sites', () => ( {
	useLiveWpcomSites: () => connectedSites,
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
	useSnapshots: () => ( { data: [ ...snapshots ] } ),
	useSnapshotUsage: () => ( { data: snapshotUsage } ),
	useDeleteSnapshot: () => ( { mutate: deleteSnapshotMutate } ),
	useRenameSnapshot: () => ( { mutate: renameSnapshotMutate } ),
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

function mainViewTree( {
	siteOverrides = {},
	activity = null,
}: {
	siteOverrides?: Partial< SiteDetails >;
	activity?: SyncActivity | null;
} = {} ) {
	// The live row's "more" submenu needs the Menu.Root + Popup contexts the
	// dropdown provides around MainView in the real app.
	return (
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

function renderMainView( options: Parameters< typeof mainViewTree >[ 0 ] = {} ) {
	return render( mainViewTree( options ) );
}

function openPreviewMenu() {
	fireEvent.click(
		screen.getByRole( 'menuitem', { name: 'More actions for Demo Site Preview 1' } )
	);
}

describe( 'MainView', () => {
	beforeEach( () => {
		vi.mocked( useIsMutating ).mockImplementation( () => 0 );
		connector.copyText.mockReset();
		connector.openExternalUrl.mockReset();
		cancelSyncMutate.mockReset();
		publishPreviewMutate.mockReset();
		deleteSnapshotMutate.mockReset();
		renameSnapshotMutate.mockReset();
		startSiteMutate.mockReset();
		stopSiteMutate.mockReset();
		transitions.starting = false;
		transitions.stopping = false;
		snapshots.splice( 0, snapshots.length, {
			url: 'preview.example.com',
			atomicSiteId: 123,
			localSiteId: site.id,
			date: Date.now(),
			name: 'Demo Site Preview 1',
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

	it( "lists every one of the site's previews, newest first", () => {
		snapshots.push(
			{ ...snapshots[ 0 ], url: 'newer.example.com', name: 'Newer', date: Date.now() + 1 },
			{ ...snapshots[ 0 ], url: 'other.example.com', name: 'Other site', localSiteId: 'site-2' }
		);

		renderMainView();

		const names = screen
			.getAllByRole( 'button', { name: /^Open .* in your browser$/ } )
			.map( ( button ) => button.getAttribute( 'aria-label' ) );
		expect( names ).toEqual( [
			'Open Studio site in your browser',
			'Open Newer in your browser',
			'Open Demo Site Preview 1 in your browser',
		] );
	} );

	it( 'recreates an expired preview under its name and drops the expired entry', () => {
		snapshots[ 0 ].date = Date.now() - 8 * 24 * 60 * 60 * 1000;
		publishPreviewMutate.mockImplementation( ( _variables, { onSuccess } ) =>
			onSuccess( { url: 'fresh.example.com' } )
		);

		renderMainView();

		expect( screen.getByText( 'Expired yesterday' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Copy preview URL' } ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Recreate preview' } ) );

		expect( publishPreviewMutate ).toHaveBeenCalledWith(
			{ siteId: site.id, existingHostname: undefined, name: 'Demo Site Preview 1' },
			expect.anything()
		);
		expect( deleteSnapshotMutate ).toHaveBeenCalledWith( { hostname: 'preview.example.com' } );
	} );

	it( 'shows publishing progress on the preview being updated', () => {
		renderMainView( {
			activity: {
				kind: 'pending',
				direction: 'preview',
				hostname: 'preview.example.com',
				message: 'Uploading archive…',
				progress: 30,
			},
		} );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Demo Site Preview 1' );
		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Uploading archive…' );
		expect(
			screen.queryByRole( 'button', { name: 'Open Demo Site Preview 1 in your browser' } )
		).not.toBeInTheDocument();
	} );

	it( 'shows the progress of a new preview in place of the header notice', () => {
		snapshots.splice( 0, snapshots.length );
		const { unmount } = renderMainView();
		expect( screen.getByText( 'Share a review link for this version.' ) ).toBeInTheDocument();
		unmount();

		renderMainView( {
			activity: { kind: 'pending', direction: 'preview', message: 'Creating archive…' },
		} );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( /^Creating archive…$/ );
		expect( screen.queryByText( 'Share a review link for this version.' ) ).not.toBeInTheDocument();
	} );

	it( 'holds the finished progress until the new preview is listed', () => {
		const { rerender } = renderMainView( {
			activity: { kind: 'pending', direction: 'preview', message: 'Saving preview site…' },
		} );

		rerender( mainViewTree( { activity: { kind: 'success', direction: 'preview' } } ) );
		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Saving preview site…' );

		snapshots.push( { ...snapshots[ 0 ], url: 'new.example.com', name: 'New one' } );
		rerender( mainViewTree( { activity: { kind: 'success', direction: 'preview' } } ) );
		expect( screen.queryByRole( 'status' ) ).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Open New one in your browser' } )
		).toBeInTheDocument();
	} );

	it( 'renames a preview inline, saving only a changed name', () => {
		renderMainView();

		openPreviewMenu();
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Rename' } ) );
		const input = screen.getByRole( 'textbox', { name: 'Preview name' } );
		expect( screen.queryByRole( 'button', { name: 'Save name' } ) ).not.toBeInTheDocument();

		fireEvent.change( input, { target: { value: '  Client review  ' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save name' } ) );

		expect( renameSnapshotMutate ).toHaveBeenCalledWith( {
			hostname: 'preview.example.com',
			name: 'Client review',
		} );
	} );

	it( 'asks before deleting a preview', () => {
		renderMainView();

		openPreviewMenu();
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Delete' } ) );
		expect( screen.getByText( 'Delete this preview?' ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( deleteSnapshotMutate ).not.toHaveBeenCalled();

		openPreviewMenu();
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Delete' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Delete' } ) );
		expect( deleteSnapshotMutate ).toHaveBeenCalledWith( { hostname: 'preview.example.com' } );
	} );

	it( 'lists every connected site and syncs the one picked', () => {
		const staging = { ...liveSite, id: 456, name: 'Staging Site', isStaging: true };
		connectedSites.splice( 0, connectedSites.length, liveSite, staging );
		const onPullClick = vi.fn();

		render(
			<Menu.Root open>
				<Menu.Popup>
					<MainView
						site={ site }
						activity={ null }
						onSetupClick={ vi.fn() }
						onDisconnectClick={ vi.fn() }
						onPullClick={ onPullClick }
						onPushClick={ vi.fn() }
					/>
				</Menu.Popup>
			</Menu.Root>
		);

		expect( screen.getByText( 'Staging' ) ).toBeInTheDocument();
		fireEvent.click( screen.getAllByRole( 'button', { name: 'Pull from live' } )[ 1 ] );
		expect( onPullClick ).toHaveBeenCalledWith( staging );
	} );

	it( 'labels the live sync controls with plain actions while idle', () => {
		connectedSites.splice( 0, connectedSites.length, liveSite );

		renderMainView();

		const pullButton = screen.getByRole( 'button', { name: 'Pull from live' } );
		expect( pullButton.getAttribute( 'aria-disabled' ) ).not.toBe( 'true' );
		expect( screen.getByRole( 'button', { name: 'Push to live' } ) ).toBeInTheDocument();
	} );

	it( 'tells when the live site was last pulled and pushed', () => {
		connectedSites.splice( 0, connectedSites.length, {
			...liveSite,
			lastPullTimestamp: new Date( Date.now() - 2 * 60 * 60 * 1000 ).toISOString(),
			lastPushTimestamp: new Date().toISOString(),
		} );

		renderMainView();

		expect( screen.getByText( 'Pulled 2h ago · Pushed just now' ) ).toBeInTheDocument();
	} );

	it( 'offers to stop an in-flight push and reports the site being stopped', () => {
		vi.mocked( useIsMutating ).mockReturnValue( 1 );
		connectedSites.splice( 0, connectedSites.length, liveSite );

		renderMainView( {
			activity: {
				kind: 'pending',
				direction: 'push',
				phase: 'uploading',
				remoteSiteId: liveSite.id,
			},
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel push' } ) );

		expect( cancelSyncMutate ).toHaveBeenCalledWith( {
			siteId: site.id,
			remoteSiteId: liveSite.id,
		} );
		expect( screen.getByRole( 'status' ) ).not.toHaveTextContent( 'can not be cancelled' );
	} );

	it( 'disables New preview when the preview site limit is reached', () => {
		snapshots.splice( 0, snapshots.length );
		snapshotUsage = { siteCount: 10, siteLimit: 10, siteCreationBlocked: false };

		renderMainView();

		expect(
			screen.getByText( "You've used all 10 preview sites available on your account." )
		).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'New preview' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
	} );

	it( 'disables New preview when preview site creation is blocked', () => {
		snapshots.splice( 0, snapshots.length );
		snapshotUsage = { siteCount: 0, siteLimit: 10, siteCreationBlocked: true };

		renderMainView();

		expect(
			screen.getByText( 'Preview sites are not available for your account.' )
		).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'New preview' } ) ).toHaveAttribute(
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
		[ 'preview', 'Push to live (sync in progress)' ],
		[ 'import', 'Push to live (sync in progress)' ],
	] as const )( 'keeps the live sync controls busy during a %s', ( direction, busyLabel ) => {
		connectedSites.splice( 0, connectedSites.length, liveSite );

		renderMainView( { activity: { kind: 'pending', direction, remoteSiteId: liveSite.id } } );

		expect( screen.getByRole( 'button', { name: busyLabel } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.queryByRole( 'button', { name: /^Cancel / } ) ).not.toBeInTheDocument();
	} );
} );
