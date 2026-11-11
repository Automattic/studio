import { once } from 'events';
import fs from 'fs';
import * as configFile from '@studio/common/lib/cli-config-file';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { RemoteSiteError, type PushArchive, type PushStatus } from '@studio/providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getExporter } from 'cli/lib/import-export/export/export-manager';
import { reportSyncActivity } from 'cli/lib/sync-activity';
import { fetchSyncableSites, wpcomSites } from 'cli/lib/sync-api';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { runCommand } from '../push';
import type { SyncSite } from '@studio/common/types/sync';
import type { SiteData } from 'cli/lib/cli-config/core';
import type { Readable } from 'stream';

vi.mock( '@studio/common/lib/shared-config', async ( importActual ) => ( {
	...( await importActual< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/remote-sites' );
vi.mock( '@studio/common/lib/deploy-ignore' );
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
	wpcomSites: { push: vi.fn() },
} ) );
vi.mock( 'cli/lib/tracks' );

const site = { id: 'site-1', path: '/test/site', phpVersion: '8.3' } as SiteData;
const remoteSite = { id: 42, name: 'Live', syncSupport: 'syncable' } as SyncSite;

// Reads the archive to the end, as the real upload does before the push removes it, reports
// `statuses`, then ends with `outcome`.
function pushes( statuses: PushStatus[], outcome?: Error ) {
	vi.mocked( wpcomSites.push ).mockImplementation(
		async ( _config, _site, archive: PushArchive, _options, onStatus ) => {
			await once( ( archive.file as Readable ).resume(), 'close' );
			statuses.forEach( onStatus );
			if ( outcome ) {
				throw outcome;
			}
		}
	);
}

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
		pushes( [] );
		vi.mocked( getExporter ).mockImplementation( async ( { backupFile } ) => {
			return {
				on: vi.fn(),
				export: async () => fs.writeFileSync( backupFile, 'archive' ),
			} as never;
		} );
	} );

	// The phase gates cancelling a push, so every UI must see it move on.
	it( 'reports each phase, then the result', async () => {
		pushes( [
			{ phase: 'uploading', progress: 100 },
			{ phase: 'creatingRemoteBackup' },
			{ phase: 'applyingChanges', progress: 10 },
		] );

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
		await runCommand( site.path, [ 'sqls' ], String( remoteSite.id ) );

		expect( getExporter ).toHaveBeenCalledWith(
			expect.objectContaining( { stripStudioWpConfigConstants: true } )
		);
	} );

	it( 'explains a database the live site failed to import', async () => {
		pushes(
			[ { phase: 'applyingChanges' } ],
			new RemoteSiteError(
				'The database failed to import on the live site. Review your database and try again.',
				'remote_import'
			)
		);

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
			() => pushes( [ { phase: 'uploading' } ], new Error( 'Upload crashed' ) ),
		],
		[
			'remote backup',
			'remote_backup',
			() => pushes( [ { phase: 'creatingRemoteBackup' } ], new Error( 'Poll crashed' ) ),
		],
		[
			'remote import',
			'remote_import',
			() => pushes( [ { phase: 'applyingChanges' } ], new Error( 'Poll crashed' ) ),
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
