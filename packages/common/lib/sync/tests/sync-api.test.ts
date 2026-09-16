import { beforeEach, describe, expect, it, vi } from 'vitest';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import { initiateBackup } from '../sync-api';

vi.mock( '@studio/common/lib/wpcom-factory' );
vi.mock( '@studio/common/lib/wpcom-xhr-request-factory', () => ( { default: vi.fn() } ) );

function mockBackupResponse( body: unknown ) {
	const post = vi.fn().mockResolvedValue( body );
	vi.mocked( wpcomFactory ).mockReturnValue( { req: { post } } as never );
	return post;
}

describe( 'initiateBackup', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'returns the backup id the API started', async () => {
		mockBackupResponse( { success: true, backup_id: 42 } );

		await expect( initiateBackup( 'token', 123, { optionsToSync: [ 'all' ] } ) ).resolves.toBe(
			42
		);
	} );

	it( 'explains the Jetpack Backup requirement when the API reports success without a backup', async () => {
		// Seen on a site whose Jetpack was connected but carried no backup
		// product: the initiate call succeeds, then polling the returned id fails
		// server-side with "Invalid parameter(s): backup_id".
		mockBackupResponse( { success: true, backup_id: 0 } );

		await expect( initiateBackup( 'token', 123, { optionsToSync: [ 'all' ] } ) ).rejects.toThrow(
			/Jetpack Backup/
		);
	} );

	it( 'still fails plainly when the API reports failure', async () => {
		mockBackupResponse( { success: false, backup_id: 0 } );

		await expect( initiateBackup( 'token', 123, { optionsToSync: [ 'all' ] } ) ).rejects.toThrow(
			'Backup request failed'
		);
	} );
} );
