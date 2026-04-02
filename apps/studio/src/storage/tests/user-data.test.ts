/**
 * @vitest-environment node
 */
// To run tests, execute `npm run test -- src/storage/user-data.test.ts` from the root directory
import { readFile, writeFile } from 'atomically';
import { vi } from 'vitest';
import { loadUserData, lockAppdata, unlockAppdata, saveUserData } from 'src/storage/user-data';
import { UserData } from '../storage-types';

const { getUserDataFilePathMock, getAppConfigLockFilePathMock, mockFsExistsSync, mockFsMkdirSync } =
	vi.hoisted( () => {
		return {
			getUserDataFilePathMock: vi.fn().mockReturnValue( '/path/to/app/.studio/app.json' ),
			getAppConfigLockFilePathMock: vi.fn().mockReturnValue( '/path/to/app/.studio/app.json.lock' ),
			mockFsExistsSync: vi.fn().mockReturnValue( true ),
			mockFsMkdirSync: vi.fn(),
		};
	} );

vi.mock( 'fs', () => ( {
	default: {
		existsSync: mockFsExistsSync,
		mkdirSync: mockFsMkdirSync,
	},
	existsSync: mockFsExistsSync,
	mkdirSync: mockFsMkdirSync,
} ) );
vi.mock( 'src/storage/paths', () => ( {
	getUserDataFilePath: getUserDataFilePathMock,
} ) );
vi.mock( '@studio/common/lib/config-paths', () => ( {
	getAppConfigLockFilePath: getAppConfigLockFilePathMock,
} ) );

vi.mock( 'atomically', () => ( {
	readFile: vi.fn().mockResolvedValue(
		Buffer.from(
			JSON.stringify( {
				version: 1,
				siteMetadata: {
					'site-1': { sortOrder: 0 },
					'site-2': { sortOrder: 1 },
				},
				onboardingCompleted: true,
			} )
		)
	),
	writeFile: vi.fn(),
} ) );

const mockedUserData: UserData = {
	version: 1,
	siteMetadata: {
		'site-1': {
			sortOrder: 0,
		},
		'site-2': { sortOrder: 1 },
	},
	onboardingCompleted: true,
};

describe( 'User data', () => {
	afterEach( () => {
		vi.clearAllMocks();
	} );

	describe( 'loadUserData', () => {
		test( 'loads user data with siteMetadata as record', async () => {
			const result = await loadUserData();

			expect( result.siteMetadata ).toEqual( {
				'site-1': { sortOrder: 0 },
				'site-2': { sortOrder: 1 },
			} );
			expect( result.onboardingCompleted ).toBe( true );
		} );

		test( 'returns empty siteMetadata record when file does not exist', async () => {
			vi.mocked( readFile ).mockRejectedValue(
				Object.assign( new Error( 'ENOENT' ), { code: 'ENOENT' } )
			);

			const result = await loadUserData();
			expect( result ).toEqual( { version: 1, siteMetadata: {} } );
		} );

		test( 'normalizes version to 1', async () => {
			const result = await loadUserData();
			expect( result.version ).toBe( 1 );
		} );
	} );

	describe( 'saveUserData', () => {
		test( 'saves user data with version field', async () => {
			try {
				await lockAppdata();
				await saveUserData( mockedUserData );
			} finally {
				await unlockAppdata();
			}

			expect( writeFile ).toHaveBeenCalledWith(
				'/path/to/app/.studio/app.json',
				JSON.stringify( mockedUserData, null, 2 ) + '\n',
				'utf-8'
			);
		} );
	} );
} );
