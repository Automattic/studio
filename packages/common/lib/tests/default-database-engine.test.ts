import { vi } from 'vitest';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import { readDefaultDatabaseEnginePreference } from '../default-database-engine';

vi.mock( '@studio/common/lib/shared-config', () => ( {
	readSharedConfig: vi.fn(),
} ) );

describe( 'readDefaultDatabaseEnginePreference', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( readSharedConfig ).mockResolvedValue( { version: 1 } );
	} );

	it( 'returns a valid stored preference', async () => {
		vi.mocked( readSharedConfig ).mockResolvedValue( {
			version: 1,
			defaultDatabaseEngine: 'mysql',
		} );

		await expect( readDefaultDatabaseEnginePreference() ).resolves.toBe( 'mysql' );
	} );

	it( 'returns undefined when the preference is missing', async () => {
		await expect( readDefaultDatabaseEnginePreference() ).resolves.toBeUndefined();
	} );

	it( 'returns undefined when shared config cannot be read', async () => {
		vi.mocked( readSharedConfig ).mockRejectedValue( new Error( 'bad config' ) );

		await expect( readDefaultDatabaseEnginePreference() ).resolves.toBeUndefined();
	} );
} );
