import { SqliteIntegrationProvider } from '@studio/common/lib/sqlite-integration';
import { ensureSiteDatabaseReady } from 'cli/lib/site-database';

vi.mock( '@studio/common/lib/sqlite-integration' );

describe( 'ensureSiteDatabaseReady', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'prepares the database through the CLI integration provider', async () => {
		await ensureSiteDatabaseReady( '/site' );
		expect( SqliteIntegrationProvider.prototype.ensureSiteDatabaseReady ).toHaveBeenCalledWith(
			'/site'
		);
	} );

	it( 'propagates preparation failures to the caller', async () => {
		vi.mocked( SqliteIntegrationProvider.prototype.ensureSiteDatabaseReady ).mockRejectedValueOnce(
			new Error( 'SQLite integration files not found.' )
		);
		await expect( ensureSiteDatabaseReady( '/site' ) ).rejects.toThrow(
			'SQLite integration files not found.'
		);
	} );
} );
