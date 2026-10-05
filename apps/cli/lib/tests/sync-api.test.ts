import { initiateBackup as initiateBackupBase } from '@studio/common/lib/sync/sync-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initiateBackup } from 'cli/lib/sync-api';
import { LoggerError } from 'cli/logger';

vi.mock( '@studio/common/lib/sync/sync-api', async ( importActual ) => ( {
	...( await importActual< typeof import('@studio/common/lib/sync/sync-api') >() ),
	initiateBackup: vi.fn(),
} ) );

// Mirrors the error wpcom-xhr-request builds from a `{ success: false, error }` 500 body.
function wpcomError( body: { success: boolean; error: string } ) {
	return Object.assign(
		new Error( '500 status code for "POST /sites/42/studio-app/sync/backup"' ),
		{
			statusCode: 500,
			...body,
		}
	);
}

describe( 'initiateBackup', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'explains that the first backup is missing when the site has no backups yet', async () => {
		vi.mocked( initiateBackupBase ).mockRejectedValue(
			wpcomError( { success: false, error: 'No backups found for site 42' } )
		);

		const error = await initiateBackup( 'token', 42, { optionsToSync: [ 'all' ] } ).catch(
			( e ) => e
		);

		expect( error ).toBeInstanceOf( LoggerError );
		expect( error.message ).toBe(
			"Your site's first backup hasn't been created yet. Wait a few minutes and try again."
		);
		expect( error.code ).toBe( 'remote_backup' );
	} );

	it( 'keeps the server error for other backup failures', async () => {
		vi.mocked( initiateBackupBase ).mockRejectedValue(
			wpcomError( { success: false, error: '502 Bad Gateway' } )
		);

		const error = await initiateBackup( 'token', 42, { optionsToSync: [ 'all' ] } ).catch(
			( e ) => e
		);

		expect( error.message ).toBe(
			'Failed to initiate backup: 500 status code for "POST /sites/42/studio-app/sync/backup"'
		);
	} );
} );
