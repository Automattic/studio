import { readDefaultDatabaseEnginePreference } from '@studio/common/lib/default-database-engine';
import { vi } from 'vitest';
import { resolveDefaultDatabaseEngine } from '../default-engine';

vi.mock( '@studio/common/lib/default-database-engine', () => ( {
	readDefaultDatabaseEnginePreference: vi.fn(),
} ) );

describe( 'resolveDefaultDatabaseEngine', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( readDefaultDatabaseEnginePreference ).mockResolvedValue( undefined );
	} );

	it( 'uses the explicit create option before the global preference', async () => {
		vi.mocked( readDefaultDatabaseEnginePreference ).mockResolvedValue( 'mysql' );

		await expect( resolveDefaultDatabaseEngine( 'sqlite' ) ).resolves.toBe( 'sqlite' );
		expect( readDefaultDatabaseEnginePreference ).not.toHaveBeenCalled();
	} );

	it( 'uses the global preference when no explicit option is provided', async () => {
		vi.mocked( readDefaultDatabaseEnginePreference ).mockResolvedValue( 'mysql' );

		await expect( resolveDefaultDatabaseEngine() ).resolves.toBe( 'mysql' );
	} );

	it( 'falls back to SQLite when the preference is missing', async () => {
		await expect( resolveDefaultDatabaseEngine() ).resolves.toBe( 'sqlite' );
	} );
} );
