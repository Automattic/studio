import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAppConfig, updateAppConfig } from '../app-config';
import {
	type DatabaseAppearance,
	getDatabaseAppearance,
	saveDatabaseAppearance,
} from '../database-appearance';

vi.mock( '../app-config', () => ( {
	readAppConfig: vi.fn(),
	updateAppConfig: vi.fn(),
} ) );

const readAppConfigMock = vi.mocked( readAppConfig );
const updateAppConfigMock = vi.mocked( updateAppConfig );

describe( 'database appearance', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'defaults unknown and missing values to Studio', async () => {
		readAppConfigMock.mockResolvedValueOnce( {} ).mockResolvedValueOnce( {
			databaseAppearance: 'newer-value',
		} );

		await expect( getDatabaseAppearance() ).resolves.toBe( 'studio' );
		await expect( getDatabaseAppearance() ).resolves.toBe( 'studio' );
	} );

	it( 'returns the phpMyAdmin preference', async () => {
		readAppConfigMock.mockResolvedValue( { databaseAppearance: 'phpmyadmin' } );

		await expect( getDatabaseAppearance() ).resolves.toBe( 'phpmyadmin' );
	} );

	it( 'writes only the database appearance field', async () => {
		updateAppConfigMock.mockImplementation( async ( mutate ) => {
			const config = { preserved: true };
			mutate( config );
			expect( config ).toEqual( { preserved: true, databaseAppearance: 'phpmyadmin' } );
		} );

		await saveDatabaseAppearance( 'phpmyadmin' );
		expect( updateAppConfigMock ).toHaveBeenCalledOnce();
	} );

	it( 'rejects unsupported values', async () => {
		await expect( saveDatabaseAppearance( 'custom' as DatabaseAppearance ) ).rejects.toThrow(
			'Unsupported database appearance: custom'
		);
		expect( updateAppConfigMock ).not.toHaveBeenCalled();
	} );
} );
