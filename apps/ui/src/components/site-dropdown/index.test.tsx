import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteDropdown } from './index';
import type { SiteDetails, SyncSite } from '@/data/core';

// Drives the real wiring behind "confirming the sync dialog reopens the
// dropdown": the dialog closes, an effect fires, and it clicks the trigger.
// Clicking (rather than setting state) is what keeps Base UI from re-arming its
// hover-close, so this asserts the click actually happens.

const { connectedSites, pullMutate } = vi.hoisted( () => ( {
	connectedSites: [] as SyncSite[],
	pullMutate: vi.fn(),
} ) );

vi.mock( '@/data/core', () => ( { useConnector: () => ( {} ) } ) );
vi.mock( '@/data/queries/use-connected-wpcom-sites', () => ( {
	useConnectedWpcomSites: () => ( { data: connectedSites } ),
} ) );
vi.mock( '@/data/queries/use-snapshots', () => ( { useSnapshots: () => ( { data: [] } ) } ) );
vi.mock( '@/data/queries/use-sites', () => ( {
	useIsSiteStarting: () => false,
	useIsSiteStopping: () => false,
	useSiteOperation: () => undefined,
} ) );
vi.mock( '@/data/queries/use-sync-site', () => ( {
	usePullSiteFromLive: () => ( { mutate: pullMutate } ),
	usePushSiteToLive: () => ( { mutate: vi.fn() } ),
} ) );
vi.mock( '@/data/sync-activity', () => ( { useSiteSyncActivity: () => null } ) );
vi.mock( '@/components/selective-sync/lib/get-ipc-api', () => ( {
	registerSelectiveSyncConnector: vi.fn(),
} ) );
vi.mock( './disconnect-site-dialog', () => ( { DisconnectSiteDialog: () => null } ) );
vi.mock( '@/components/selective-sync/lib/convert-tree-to-sync-options', () => ( {
	convertTreeToPullOptions: () => ( { optionsToSync: [ 'all' ], include_path_list: [] } ),
	convertTreeToReprintPullOptions: () => ( { onlyPaths: [], skipDatabase: false } ),
	convertTreeToPushOptions: () => ( { optionsToSync: [ 'all' ] } ),
} ) );
vi.mock( './publish-picker-view', () => ( { PublishPickerView: () => null } ) );

// Stand-ins for the popup contents and the dialog, so the test can drive
// "open the dialog" and "confirm it" without their real dependencies.
vi.mock( './main-view', () => ( {
	MainView: ( { onPullClick }: { onPullClick: () => void } ) => (
		<button onClick={ onPullClick }>Pull from live</button>
	),
} ) );
vi.mock( '@/components/selective-sync/sync-dialog', () => ( {
	SyncDialog: ( { onPull }: { onPull: ( tree: unknown[] ) => void } ) => (
		<button onClick={ () => onPull( [] ) }>Confirm pull</button>
	),
} ) );

const site: SiteDetails = {
	id: 'site-1',
	name: 'Demo Site',
	path: '/tmp/demo-site',
	port: 8881,
	running: true,
	phpVersion: '8.3',
};

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

describe( 'SiteDropdown sync dialog', () => {
	beforeEach( () => {
		pullMutate.mockReset();
		connectedSites.splice( 0, connectedSites.length, liveSite );
	} );

	it( 'reopens the dropdown after the pull is confirmed', async () => {
		render( <SiteDropdown site={ site } /> );

		fireEvent.click( screen.getByRole( 'button', { name: /Demo Site/ } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Pull from live' } ) );

		// The dialog replaces the dropdown, matching the disconnect dialog's rule.
		expect( screen.queryByRole( 'button', { name: 'Pull from live' } ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Confirm pull' } ) );

		expect( pullMutate ).toHaveBeenCalledWith(
			expect.objectContaining( { siteId: site.id, remoteSiteId: liveSite.id } )
		);
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Pull from live' } ) ).toBeInTheDocument()
		);
	} );

	it( 'leaves the dropdown closed when the dialog is dismissed without syncing', async () => {
		render( <SiteDropdown site={ site } /> );

		fireEvent.click( screen.getByRole( 'button', { name: /Demo Site/ } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Pull from live' } ) );

		expect( screen.queryByRole( 'button', { name: 'Pull from live' } ) ).not.toBeInTheDocument();
		expect( pullMutate ).not.toHaveBeenCalled();
	} );
} );
