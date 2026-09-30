import fs from 'fs';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getExporter } from 'cli/lib/import-export/export/export-manager';
import { reportSyncActivity } from 'cli/lib/sync-activity';
import { fetchSyncableSites, pollImportStatus } from 'cli/lib/sync-api';
import { runCommand } from '../push';
import type { SyncSite } from '@studio/common/types/sync';
import type { SiteData } from 'cli/lib/cli-config/core';

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
			'creatingBackup',
			'uploading',
			'creatingRemoteBackup',
			'applyingChanges',
			'success',
		] );
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
