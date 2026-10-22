import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Menu from '@/components/menu';
import { MainView } from './main-view';
import type { SiteDetails, Snapshot } from '@/data/core';
import type { SyncActivity } from '@/data/sync-activity';

const {
	connector,
	snapshots,
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

vi.mock( '@/components/open-in-menu/use-open-in-destinations', () => ( {
	useOpenInDestinations: () => [],
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => connector,
} ) );

vi.mock( '@/data/queries/use-agentic-features', () => ( {
	useAgenticFeatures: vi.fn( () => ( { enabled: true, reason: null, isReady: true } ) ),
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

vi.mock( '@/data/queries/use-user-locale', () => ( {
	useUserLocale: () => undefined,
} ) );

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
	// The preview rows' "more" submenu needs the Menu.Root + Popup contexts the
	// dropdown provides around MainView in the real app.
	return (
		<Menu.Root open>
			<Menu.Popup>
				<MainView site={ { ...site, ...siteOverrides } } activity={ activity } />
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
		connector.copyText.mockReset();
		connector.openExternalUrl.mockReset();
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

	it( 'shows detailed import progress in the open site status', () => {
		renderMainView( {
			activity: { kind: 'pending', direction: 'import', message: '24% · Media uploads…' },
		} );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Importing backup…' );
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
} );
