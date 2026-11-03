import fs from 'fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as configFile from '@studio/common/lib/cli-config-file';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { getCliConfigPath } from '@studio/common/lib/well-known-paths';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as configStore from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getExporter } from 'cli/lib/import-export/export/export-manager';
import { reportSyncActivity } from 'cli/lib/sync-activity';
import { fetchSyncableSites, pollImportStatus } from 'cli/lib/sync-api';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { runCommand } from '../push';
import type { SyncSite } from '@studio/common/types/sync';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.unmock( 'lockfile' );

vi.mock( '@studio/common/lib/shared-config', async ( importActual ) => ( {
	...( await importActual< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/connected-sites' );
vi.mock( '@studio/common/lib/deploy-ignore' );
vi.mock( '@studio/common/lib/sync/constants', async ( importActual ) => ( {
	...( await importActual< typeof import('@studio/common/lib/sync/constants') >() ),
	SYNC_POLL_INTERVAL_MS: 0,
} ) );
vi.mock( '@studio/common/lib/sync/tus-upload', () => ( {
	createTusUpload: () => ( { promise: Promise.resolve( 'attachment-1' ), abort: vi.fn() } ),
} ) );
vi.mock( 'cli/lib/cli-config/sites', async ( importActual ) => ( {
	...( await importActual< typeof import('cli/lib/cli-config/sites') >() ),
	getSiteByFolder: vi.fn(),
} ) );
vi.mock( 'cli/lib/import-export/export/export-manager' );
vi.mock( 'cli/lib/site-operations', () => ( {
	withSiteOperation: ( _folder: string, _kind: string, fn: () => unknown ) => fn(),
} ) );
vi.mock( 'cli/lib/sqlite-integration' );
vi.mock( 'cli/lib/sync-activity' );
vi.mock( 'cli/lib/sync-api', async ( importActual ) => ( {
	...( await importActual< typeof import('cli/lib/sync-api') >() ),
	fetchSyncableSites: vi.fn(),
	initiateImport: vi.fn(),
	pollImportStatus: vi.fn(),
} ) );
vi.mock( 'cli/lib/tracks' );

const site = { id: 'site-1', path: '/test/site', phpVersion: '8.3' } as SiteData;
const remoteSite = { id: 42, name: 'Live', syncSupport: 'syncable' } as SyncSite;

function reported() {
	return vi.mocked( reportSyncActivity ).mock.calls.map( ( [ , activity ] ) => activity );
}

let configDirectory: string;
const siteTracksId = '6ad36785-267a-4e6d-b036-0a7460c76497';
beforeEach( async () => {
	configDirectory = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio-event-tracks-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', configDirectory );
	await fsPromises.writeFile(
		getCliConfigPath(),
		JSON.stringify( {
			version: 1,
			sites: [
				{
					id: 'site-1',
					name: 'Private site title',
					path: '/test/site',
					port: 8080,
					phpVersion: '8.3',
					tracksId: siteTracksId,
				},
			],
			snapshots: [],
		} )
	);
} );
afterEach( async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await fsPromises.rm( configDirectory, { recursive: true, force: true } );
} );

describe( 'CLI: studio push', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( readAuthToken ).mockResolvedValue( { accessToken: 'token' } as never );
		vi.mocked( getSiteByFolder ).mockResolvedValue( site );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [ remoteSite ] );
		vi.mocked( getExporter ).mockImplementation( async ( { backupFile } ) => {
			return {
				on: vi.fn(),
				export: async () => fs.writeFileSync( backupFile, 'archive' ),
			} as never;
		} );
	} );

	// The phase gates cancelling a push, so every UI must see it move on.
	it( 'reports each phase, then the result', async () => {
		vi.mocked( pollImportStatus )
			.mockResolvedValueOnce( { success: true, status: 'archive_import_started' } as never )
			.mockResolvedValueOnce( { success: true, status: 'finished' } as never );

		await runCommand( site.path, [ 'all' ], String( remoteSite.id ) );

		expect(
			reported().map( ( activity ) => ( 'phase' in activity ? activity.phase : activity.kind ) )
		).toEqual( [
			'pending',
			'pending',
			'creatingBackup',
			'uploading',
			'creatingRemoteBackup',
			'applyingChanges',
			'success',
		] );
		expect( reported()[ 1 ] ).toMatchObject( { remoteSiteId: remoteSite.id } );
	} );

	it.each( [ '', 'studio-ui:v2' ] )(
		'reuses and backfills the site UUID on successful pushes (origin %s)',
		async ( origin ) => {
			vi.stubEnv( 'STUDIO_TRACKS_ORIGIN', origin );
			const config = await configStore.readCliConfig();
			delete config.sites[ 0 ].tracksId;
			await configStore.lockCliConfig();
			try {
				await configStore.saveCliConfig( config );
			} finally {
				await configStore.unlockCliConfig();
			}
			vi.mocked( pollImportStatus ).mockResolvedValue( {
				success: true,
				status: 'finished',
			} as never );
			await Promise.all( [
				runCommand( site.path, [ 'all' ], String( remoteSite.id ) ),
				runCommand( site.path, [ 'all' ], String( remoteSite.id ) ),
			] );
			const stored = ( await configStore.readCliConfig() ).sites[ 0 ].tracksId;
			expect( stored ).toMatch( /^[0-9a-f-]{36}$/ );
			expect( recordTracksEvent ).toHaveBeenCalledTimes( 2 );
			for ( const [ event, props ] of vi.mocked( recordTracksEvent ).mock.calls ) {
				expect( event ).toBe( TRACKS_EVENTS.SYNC_PUSH );
				expect( props ).toMatchObject( { success: true, site_id: stored } );
				expect( props ).not.toHaveProperty( 'preview_id' );
			}
		}
	);
	it( 'does not resolve or record telemetry when the push event is suppressed', async () => {
		vi.mocked( pollImportStatus ).mockResolvedValue( {
			success: true,
			status: 'finished',
		} as never );
		const read = vi.spyOn( configFile, 'readCliConfigFileRaw' );
		await runCommand( site.path, [ 'all' ], String( remoteSite.id ), undefined, {
			suppressTracksEvent: true,
		} );
		expect( recordTracksEvent ).not.toHaveBeenCalled();
		expect( read ).not.toHaveBeenCalled();
	} );

	it.each( [
		'lockCliConfigFile',
		'readCliConfigFileRaw',
		'writeCliConfigFileRaw',
		'unlockCliConfigFile',
	] as const )( 'keeps a successful push and its event when ID %s fails', async ( operation ) => {
		const config = await configStore.readCliConfig();
		delete config.sites[ 0 ].tracksId;
		await configStore.lockCliConfig();
		try {
			await configStore.saveCliConfig( config );
		} finally {
			await configStore.unlockCliConfig();
		}
		vi.mocked( pollImportStatus ).mockResolvedValue( {
			success: true,
			status: 'finished',
		} as never );
		vi.spyOn( configFile, operation ).mockRejectedValueOnce( new Error( 'Storage unavailable' ) );
		await expect( runCommand( site.path, [ 'all' ], String( remoteSite.id ) ) ).resolves.toBe(
			remoteSite
		);
		expect( recordTracksEvent ).toHaveBeenCalledExactlyOnceWith(
			TRACKS_EVENTS.SYNC_PUSH,
			expect.objectContaining( { success: true } )
		);
		expect( vi.mocked( recordTracksEvent ).mock.calls[ 0 ][ 1 ] ).not.toHaveProperty( 'site_id' );
	} );
	it( "keeps Studio's local wp-config.php constants out of the pushed archive", async () => {
		vi.mocked( pollImportStatus ).mockResolvedValue( {
			success: true,
			status: 'finished',
		} as never );

		await runCommand( site.path, [ 'sqls' ], String( remoteSite.id ) );

		expect( getExporter ).toHaveBeenCalledWith(
			expect.objectContaining( { stripStudioWpConfigConstants: true } )
		);
	} );

	it( 'explains a database the live site failed to import', async () => {
		vi.mocked( pollImportStatus ).mockResolvedValue( {
			success: false,
			status: 'failed',
			error_data: { vp_restore_message: 'Error importing SQL dump' },
		} as never );

		await expect( runCommand( site.path, [ 'all' ], String( remoteSite.id ) ) ).rejects.toThrow(
			'The database failed to import on the live site.'
		);
		expect( reported().at( -1 ) ).toMatchObject( {
			kind: 'error',
			message: expect.stringContaining( 'The database failed to import on the live site.' ),
		} );
	} );
} );
