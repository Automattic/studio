import { once } from 'events';
import fs from 'fs';
import * as configFile from '@studio/common/lib/cli-config-file';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { createTusUpload } from '@studio/common/lib/sync/tus-upload';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getExporter } from 'cli/lib/import-export/export/export-manager';
import { reportSyncActivity } from 'cli/lib/sync-activity';
import { fetchSyncableSites, pollImportStatus } from 'cli/lib/sync-api';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { runCommand } from '../push';
import type { SyncSite } from '@studio/common/types/sync';
import type { SiteData } from 'cli/lib/cli-config/core';
import type { Readable } from 'stream';

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
vi.mock( '@studio/common/lib/sync/tus-upload', () => ( { createTusUpload: vi.fn() } ) );
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

const siteTracksId = '6ad36785-267a-4e6d-b036-0a7460c76497';
beforeEach( () => {
	vi.spyOn( configFile, 'readCliConfigFileRaw' ).mockResolvedValue( {
		version: 1,
		sites: [ { id: 'site-1', name: 'Private title', path: '/test/site', tracksId: siteTracksId } ],
		snapshots: [],
	} );
} );
afterEach( () => vi.restoreAllMocks() );

describe( 'CLI: studio push', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( readAuthToken ).mockResolvedValue( { accessToken: 'token' } as never );
		vi.mocked( getSiteByFolder ).mockResolvedValue( site );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [ remoteSite ] );
		// Reads the archive to the end, as the real upload does before the push removes it.
		vi.mocked( createTusUpload ).mockImplementation( ( { file } ) => ( {
			promise: once( ( file as Readable ).resume(), 'close' ).then( () => 'attachment-1' ),
			abort: vi.fn(),
		} ) );
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
		expect( recordTracksEvent ).toHaveBeenCalledExactlyOnceWith(
			TRACKS_EVENTS.SYNC_PUSH,
			expect.objectContaining( { success: true, site_id: siteTracksId } )
		);
		expect( vi.mocked( recordTracksEvent ).mock.calls[ 0 ][ 1 ] ).not.toHaveProperty(
			'preview_id'
		);
	} );

	it( 'keeps a successful push and its event when the site ID cannot be read', async () => {
		vi.mocked( pollImportStatus ).mockResolvedValue( {
			success: true,
			status: 'finished',
		} as never );
		vi.spyOn( configFile, 'readCliConfigFileRaw' ).mockRejectedValueOnce(
			new Error( 'Storage unavailable' )
		);
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

	it.each( [
		[
			'export',
			'local_export',
			() =>
				vi.mocked( getExporter ).mockResolvedValue( {
					on: vi.fn(),
					export: () => Promise.reject( new Error( 'Export crashed' ) ),
				} as never ),
		],
		[
			'upload',
			'upload',
			() =>
				vi.mocked( createTusUpload ).mockImplementation( ( { file } ) => ( {
					promise: once( ( file as Readable ).resume(), 'close' ).then( () =>
						Promise.reject( new Error( 'Upload crashed' ) )
					),
					abort: vi.fn(),
				} ) ),
		],
		[
			'remote backup',
			'remote_backup',
			() => vi.mocked( pollImportStatus ).mockRejectedValue( new Error( 'Poll crashed' ) ),
		],
		[
			'remote import',
			'remote_import',
			() =>
				vi
					.mocked( pollImportStatus )
					.mockResolvedValueOnce( { success: true, status: 'archive_import_started' } as never )
					.mockRejectedValue( new Error( 'Poll crashed' ) ),
		],
	] )(
		'attributes an uncoded failure during the %s to that step',
		async ( _, failureReason, fail ) => {
			fail();

			await expect( runCommand( site.path, [ 'all' ], String( remoteSite.id ) ) ).rejects.toThrow();

			expect( recordTracksEvent ).toHaveBeenCalledExactlyOnceWith(
				TRACKS_EVENTS.SYNC_PUSH,
				expect.objectContaining( {
					success: false,
					failure_reason: failureReason,
					selection: 'full',
					includes_database: true,
				} )
			);
		}
	);
} );
