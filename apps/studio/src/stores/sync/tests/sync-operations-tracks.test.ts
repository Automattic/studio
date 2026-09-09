import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordRendererTracksEvent } from 'src/lib/analytics';
import { store } from 'src/stores';
import { syncOperationsActions, syncOperationsThunks } from 'src/stores/sync';

vi.mock( 'src/lib/analytics', () => ( {
	recordRendererTracksEvent: vi.fn(),
} ) );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		updateConnectedWpcomSites: vi.fn().mockResolvedValue( undefined ),
		checkSyncBackupSize: vi.fn().mockResolvedValue( 1 ),
		downloadSyncBackup: vi.fn().mockResolvedValue( '/tmp/backup.tar.gz' ),
		importSite: vi.fn().mockResolvedValue( undefined ),
		showNotification: vi.fn(),
		showMessageBox: vi.fn().mockResolvedValue( { response: 0 } ),
	} ),
} ) );

const SELECTED_SITE_ID = 'local-1';
const REMOTE_SITE_ID = 42;

function makeClient( status: string, downloadUrl: string | null = null ) {
	return {
		req: {
			get: vi.fn().mockResolvedValue( {
				status,
				download_url: downloadUrl,
				percent: status === 'finished' ? 100 : 40,
			} ),
		},
	};
}

function seedPullState() {
	store.dispatch(
		syncOperationsActions.updatePullState( {
			selectedSiteId: SELECTED_SITE_ID,
			remoteSiteId: REMOTE_SITE_ID,
			state: {
				backupId: 7,
				status: { key: 'in-progress', progress: 30, message: 'Initializing remote backup…' },
				downloadUrl: null,
				remoteSiteUrl: 'https://live.example.com',
				selectedSite: { id: SELECTED_SITE_ID, name: 'Local Site' } as never,
				startedAt: Date.now() - 1000,
				remoteIsPressable: true,
			},
		} )
	);
}

describe( 'Classic pull poller Tracks events', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		store.dispatch(
			syncOperationsActions.clearPullState( {
				selectedSiteId: SELECTED_SITE_ID,
				remoteSiteId: REMOTE_SITE_ID,
			} )
		);
		seedPullState();
	} );

	// The remote can give up on the backup. That response has no download URL, so
	// it used to fall through to the progress branch and stop the poller silently,
	// inflating pull success rates against push.
	it( 'records a failure when the remote backup fails', async () => {
		await store.dispatch(
			syncOperationsThunks.pollPullBackup( {
				client: makeClient( 'failed' ) as never,
				selectedSiteId: SELECTED_SITE_ID,
				remoteSiteId: REMOTE_SITE_ID,
				signal: new AbortController().signal,
			} )
		);

		expect( recordRendererTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.SYNC_PULL,
			expect.objectContaining( {
				success: false,
				sync_type: 'pressable',
				failure_reason: 'remote_backup',
				time_ms: expect.any( Number ),
			} )
		);
	} );

	it( 'surfaces the failed backup in the pull state so the poller stops', async () => {
		await store.dispatch(
			syncOperationsThunks.pollPullBackup( {
				client: makeClient( 'failed' ) as never,
				selectedSiteId: SELECTED_SITE_ID,
				remoteSiteId: REMOTE_SITE_ID,
				signal: new AbortController().signal,
			} )
		);

		const state =
			store.getState().syncOperations.pullStates[ `${ SELECTED_SITE_ID }-${ REMOTE_SITE_ID }` ];
		expect( state.status.key ).toBe( 'failed' );
	} );

	it( 'records nothing while the backup is still in progress', async () => {
		await store.dispatch(
			syncOperationsThunks.pollPullBackup( {
				client: makeClient( 'in-progress' ) as never,
				selectedSiteId: SELECTED_SITE_ID,
				remoteSiteId: REMOTE_SITE_ID,
				signal: new AbortController().signal,
			} )
		);

		expect( recordRendererTracksEvent ).not.toHaveBeenCalled();
	} );
} );
