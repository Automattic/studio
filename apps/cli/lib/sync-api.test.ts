import { fetchLatestRewindId as fetchLatestRewindIdBase } from '@studio/common/lib/sync/sync-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLatestRewindId } from 'cli/lib/sync-api';

vi.mock( '@studio/common/lib/sync/sync-api', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/sync/sync-api') >() ),
	fetchLatestRewindId: vi.fn(),
} ) );

describe( 'fetchLatestRewindId', () => {
	beforeEach( () => vi.resetAllMocks() );

	it.each( [
		Object.assign( new Error( 'Precondition Failed' ), {
			statusCode: 412,
			error: 'rest_forbidden',
		} ),
		new Error( 'No rewind ID available' ),
	] )( 'identifies a missing backup', async ( error ) => {
		vi.mocked( fetchLatestRewindIdBase ).mockRejectedValue( error );
		await expect( fetchLatestRewindId( 'token', 1 ) ).rejects.toMatchObject( {
			code: 'missing_backup',
		} );
	} );

	it.each( [
		new Error( 'Network failure' ),
		Object.assign( new Error( 'Forbidden' ), { statusCode: 403, error: 'rest_forbidden' } ),
	] )( 'preserves other failures', async ( error ) => {
		vi.mocked( fetchLatestRewindIdBase ).mockRejectedValue( error );
		await expect( fetchLatestRewindId( 'token', 1 ) ).rejects.toMatchObject( {
			code: 'remote_backup',
		} );
	} );
} );
