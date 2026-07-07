/**
 * @vitest-environment node
 */
import { existsSync } from 'node:fs';
import { getAppConfigPath } from '@studio/common/lib/well-known-paths';
import { readFile, writeFile } from 'atomically';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDesksConfig } from 'src/migrations/07-remove-desks-config';
import { lockAppdata, unlockAppdata } from 'src/storage/user-data';

vi.mock( 'node:fs' );
vi.mock( 'atomically', () => ( {
	readFile: vi.fn(),
	writeFile: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/well-known-paths', () => ( {
	getAppConfigPath: vi.fn( () => '/mock/app.json' ),
	getAppConfigLockFilePath: vi.fn( () => '/mock/app.json.lock' ),
} ) );
vi.mock( 'src/storage/user-data', () => ( {
	lockAppdata: vi.fn(),
	unlockAppdata: vi.fn(),
} ) );

const appConfig = {
	version: 1,
	siteMetadata: {},
	colorScheme: 'dark',
	desks: {
		settings: { showSiteName: true },
		user: { widgets: [] },
	},
};

describe( 'removeDesksConfig', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( existsSync ).mockReturnValue( true );
		vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( appConfig ) ) );
	} );

	it( 'needs to run when app config has desks data', async () => {
		await expect( removeDesksConfig.needsToRun() ).resolves.toBe( true );
	} );

	it( 'does not need to run when app config has no desks data', async () => {
		const { desks: _desks, ...configWithoutDesks } = appConfig;
		vi.mocked( readFile ).mockResolvedValueOnce(
			Buffer.from( JSON.stringify( configWithoutDesks ) )
		);

		await expect( removeDesksConfig.needsToRun() ).resolves.toBe( false );
	} );

	it( 'does not need to run when app config is missing or invalid', async () => {
		vi.mocked( existsSync ).mockReturnValueOnce( false );
		await expect( removeDesksConfig.needsToRun() ).resolves.toBe( false );

		vi.mocked( existsSync ).mockReturnValueOnce( true );
		vi.mocked( readFile ).mockResolvedValueOnce( Buffer.from( '{' ) );
		await expect( removeDesksConfig.needsToRun() ).resolves.toBe( false );
	} );

	it( 'removes only desks data from app config under lock', async () => {
		await removeDesksConfig.run();

		expect( lockAppdata ).toHaveBeenCalledTimes( 1 );
		expect( unlockAppdata ).toHaveBeenCalledTimes( 1 );
		expect( writeFile ).toHaveBeenCalledWith(
			getAppConfigPath(),
			JSON.stringify(
				{
					version: 1,
					siteMetadata: {},
					colorScheme: 'dark',
				},
				null,
				2
			) + '\n',
			{ encoding: 'utf8' }
		);
	} );

	it( 'unlocks appdata when writing fails', async () => {
		vi.mocked( writeFile ).mockRejectedValueOnce( new Error( 'write failed' ) );

		await expect( removeDesksConfig.run() ).rejects.toThrow( 'write failed' );
		expect( unlockAppdata ).toHaveBeenCalledTimes( 1 );
	} );
} );
