import { resolveDefaultDatabaseEngine as resolveSharedDefaultDatabaseEngine } from '@studio/common/lib/default-database-engine';
import { vi } from 'vitest';
import { resolveDefaultDatabaseEngine } from '../default-engine';

vi.mock( '@studio/common/lib/default-database-engine', () => ( {
	resolveDefaultDatabaseEngine: vi.fn(),
} ) );

describe( 'resolveDefaultDatabaseEngine', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( resolveSharedDefaultDatabaseEngine ).mockResolvedValue( 'sqlite' );
	} );

	it( 'returns the provider engine for the resolved shared default', async () => {
		vi.mocked( resolveSharedDefaultDatabaseEngine ).mockResolvedValue( 'mysql' );

		await expect( resolveDefaultDatabaseEngine( 'sqlite' ) ).resolves.toBe( 'mysql' );
		expect( resolveSharedDefaultDatabaseEngine ).toHaveBeenCalledWith( 'sqlite' );
	} );
} );
