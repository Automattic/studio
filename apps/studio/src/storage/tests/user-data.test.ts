/**
 * @vitest-environment node
 */
// To run tests, execute `npm run test -- src/storage/user-data.test.ts` from the root directory
import { readFile, writeFile } from 'atomically';
import { vi } from 'vitest';
import { loadUserData, lockAppdata, unlockAppdata, saveUserData } from 'src/storage/user-data';
import { UserData } from '../storage-types';

const { getUserDataFilePathMock, getUserDataLockFilePathMock, mockFsExistsSync, mockFsMkdirSync } =
	vi.hoisted( () => {
		return {
			getUserDataFilePathMock: vi.fn().mockReturnValue( '/path/to/app/.studio/appdata.json' ),
			getUserDataLockFilePathMock: vi
				.fn()
				.mockReturnValue( '/path/to/app/.studio/appdata.json.lock' ),
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
	getUserDataLockFilePath: getUserDataLockFilePathMock,
} ) );

vi.mock( 'atomically', () => ( {
	readFile: vi.fn().mockResolvedValue(
		Buffer.from(
			JSON.stringify( {
				version: 1,
				sites: {
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
	sites: {
		'site-1': {
			sortOrder: 0,
			themeDetails: {
				name: 'Twenty Twenty-Four',
				path: '/themes/twentytwentyfour',
				slug: 'twentytwentyfour',
				isBlockTheme: true,
				supportsWidgets: false,
				supportsMenus: false,
			},
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
		test( 'loads user data with sites as record', async () => {
			const result = await loadUserData();

			expect( result.sites ).toEqual( {
				'site-1': { sortOrder: 0 },
				'site-2': { sortOrder: 1 },
			} );
			expect( result.onboardingCompleted ).toBe( true );
		} );

		test( 'returns empty sites record when file does not exist', async () => {
			vi.mocked( readFile ).mockRejectedValue(
				Object.assign( new Error( 'ENOENT' ), { code: 'ENOENT' } )
			);

			const result = await loadUserData();
			expect( result ).toEqual( { sites: {} } );
		} );

		test( 'strips version field from loaded data', async () => {
			const result = await loadUserData();
			expect( result ).not.toHaveProperty( 'version' );
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
				'/path/to/app/.studio/appdata.json',
				JSON.stringify(
					{
						version: 1,
						...mockedUserData,
					},
					null,
					2
				) + '\n',
				'utf-8'
			);
		} );
	} );
} );
