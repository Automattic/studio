import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enableReprintExporter } from 'cli/lib/api';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { reportSyncActivity } from 'cli/lib/sync-activity';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { pickSyncSite } from 'cli/lib/sync-site-picker';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { LoggerError } from 'cli/logger';
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
} ) );
vi.mock( 'cli/lib/api', async ( importActual ) => ( {
	...( await importActual< typeof import('cli/lib/api') >() ),
	enableReprintExporter: vi.fn(),
} ) );
vi.mock( 'cli/lib/sync-activity' );
vi.mock( 'cli/lib/sync-site-picker', async ( importActual ) => ( {
	...( await importActual< typeof import('cli/lib/sync-site-picker') >() ),
	pickSyncSite: vi.fn(),
} ) );
vi.mock( 'cli/lib/preview-sites', () => ( {
	getStandingPreviews: vi.fn().mockResolvedValue( new Map() ),
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
	vi.mocked( getConnectedWpcomSitesForLocalSite ).mockResolvedValue( [] );
	vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
	vi.mocked( fetchSyncableSites ).mockResolvedValue( [ remoteSite ] );
	vi.mocked( pickSyncSite ).mockResolvedValue( remoteSite );
} );

describe( 'CLI: studio pull Tracks events', () => {
	it( "records a failure with the site's sync type and a classified reason, and tells the app", async () => {
		vi.mocked( enableReprintExporter ).mockRejectedValue(
			new LoggerError( 'Failed to enable the export', undefined, 'remote_backup' )
		);

		await expect( runPull( testSite.path, String( remoteSite.id ) ) ).rejects.toThrow();

		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.SYNC_PULL,
			expect.objectContaining( {
				success: false,
				sync_type: 'pressable',
				site_kind: 'site',
				failure_reason: 'remote_backup',
				time_ms: expect.any( Number ),
				// Proves `getTracksOrigin()` was spread in.
				channel: 'studio-cli',
			} )
		);
		expect( vi.mocked( reportSyncActivity ).mock.calls.at( -1 ) ).toEqual( [
			testSite.id,
			expect.objectContaining( { kind: 'error', direction: 'pull', localChangesApplied: false } ),
		] );
	} );

	// The agentic UI drives its pulls by forking this very command, and emits the
	// event itself — without the flag the same pull would be counted twice.
	it( 'records nothing when suppressed', async () => {
		vi.mocked( fetchSyncableSites ).mockRejectedValue( new Error( 'offline' ) );

		await expect(
			runPull( testSite.path, String( remoteSite.id ), false, {}, true )
		).rejects.toThrow();

		expect( recordTracksEvent ).not.toHaveBeenCalled();
	} );

	it( 'records nothing when the user backs out of the site picker', async () => {
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [ remoteSite, { ...remoteSite, id: 43 } ] );
		vi.mocked( pickSyncSite ).mockResolvedValue( undefined as never );
		process.stdin.isTTY = true;

		try {
			await runPull( testSite.path );
		} finally {
			process.stdin.isTTY = false;
		}

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
