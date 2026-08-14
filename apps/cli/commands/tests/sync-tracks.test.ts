import { readAuthToken } from '@studio/common/lib/shared-config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { fetchSyncableSites, initiateBackup, pollBackupStatus } from 'cli/lib/sync-api';
import { pickSyncSite } from 'cli/lib/sync-site-picker';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { runCommand as runPull } from '../pull';
import { runCommand as runPush } from '../push';
import type { SyncSite } from '@studio/common/types/sync';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( '@studio/common/lib/shared-config', async ( importActual ) => ( {
	...( await importActual< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/connected-sites' );
vi.mock( '@studio/common/lib/deploy-ignore', () => ( {
	createDeployIgnoreFilter: vi.fn().mockResolvedValue( { ignores: vi.fn() } ),
} ) );
vi.mock( 'cli/lib/cli-config/sites', async ( importActual ) => ( {
	...( await importActual< typeof import('cli/lib/cli-config/sites') >() ),
	getSiteByFolder: vi.fn(),
} ) );
vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'cli/lib/sqlite-integration' );
vi.mock( 'cli/lib/sync-api', async ( importActual ) => ( {
	...( await importActual< typeof import('cli/lib/sync-api') >() ),
	fetchSyncableSites: vi.fn(),
	initiateBackup: vi.fn(),
	pollBackupStatus: vi.fn(),
} ) );
vi.mock( 'cli/lib/sync-site-picker', async ( importActual ) => ( {
	...( await importActual< typeof import('cli/lib/sync-site-picker') >() ),
	pickSyncSite: vi.fn(),
} ) );
vi.mock( 'cli/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('cli/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );

const testSite: SiteData = {
	id: 'site-1',
	name: 'Test Site',
	path: '/test/site',
	port: 8080,
	phpVersion: '8.0',
	adminUsername: 'admin',
	adminPassword: 'password123',
};

const remoteSite = {
	id: 42,
	localSiteId: 'site-1',
	name: 'Live Site',
	url: 'https://live.example.com',
	isStaging: false,
	isPressable: true,
	environmentType: 'production',
	syncSupport: 'syncable',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
} as SyncSite;

beforeEach( () => {
	vi.clearAllMocks();
	vi.mocked( readAuthToken ).mockResolvedValue( { accessToken: 'token' } as never );
	vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
	vi.mocked( fetchSyncableSites ).mockResolvedValue( [ remoteSite ] );
	vi.mocked( pickSyncSite ).mockResolvedValue( remoteSite );
} );

describe( 'CLI: studio pull Tracks events', () => {
	it( "records a failure with the site's sync type and a classified reason", async () => {
		vi.mocked( initiateBackup ).mockResolvedValue( 7 as never );
		vi.mocked( pollBackupStatus ).mockResolvedValue( { status: 'failed', percent: 0 } as never );

		await expect( runPull( testSite.path, [ 'all' ], String( remoteSite.id ) ) ).rejects.toThrow();

		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.SYNC_PULL,
			expect.objectContaining( {
				success: false,
				sync_type: 'pressable',
				failure_reason: 'remote_backup',
				time_ms: expect.any( Number ),
				// Proves `getTracksOrigin()` was spread in.
				channel: 'studio-cli',
			} )
		);
	} );

	// The agentic UI drives its pulls by forking this very command, and emits the
	// event itself — without the flag the same pull would be counted twice.
	it( 'records nothing when suppressed', async () => {
		vi.mocked( initiateBackup ).mockResolvedValue( 7 as never );
		vi.mocked( pollBackupStatus ).mockResolvedValue( { status: 'failed', percent: 0 } as never );

		await expect(
			runPull( testSite.path, [ 'all' ], String( remoteSite.id ), undefined, true )
		).rejects.toThrow();

		expect( recordTracksEvent ).not.toHaveBeenCalled();
	} );

	it( 'records nothing when the user backs out of the site picker', async () => {
		vi.mocked( pickSyncSite ).mockResolvedValue( undefined as never );

		await runPull( testSite.path, [ 'all' ] );

		expect( recordTracksEvent ).not.toHaveBeenCalled();
	} );
} );

describe( 'CLI: studio push Tracks events', () => {
	it( 'records nothing when the user backs out of the site picker', async () => {
		vi.mocked( pickSyncSite ).mockResolvedValue( undefined as never );

		await runPush( testSite.path, [ 'all' ] );

		expect( recordTracksEvent ).not.toHaveBeenCalled();
	} );

	it( "records a failure with the site's sync type and a classified reason", async () => {
		await expect( runPush( testSite.path, [ 'all' ], String( remoteSite.id ) ) ).rejects.toThrow();

		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.SYNC_PUSH,
			expect.objectContaining( {
				success: false,
				sync_type: 'pressable',
				time_ms: expect.any( Number ),
				channel: 'studio-cli',
			} )
		);
	} );

	// These run before a remote site is known, so they'd escape an emitter placed
	// only around the transfer itself.
	it( 'records setup failures that happen before a remote site is picked', async () => {
		vi.mocked( getSiteByFolder ).mockRejectedValue(
			new Error( 'The specified directory is not added to Studio.' )
		);

		await expect( runPush( '/not/a/studio/site', [ 'all' ] ) ).rejects.toThrow();

		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.SYNC_PUSH,
			expect.objectContaining( { success: false, sync_type: 'unknown', channel: 'studio-cli' } )
		);
	} );
} );
