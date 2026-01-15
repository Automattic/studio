/**
 * @vitest-environment node
 */
// To run tests, execute `npm run test -- src/storage/user-data.test.ts` from the root directory
import { readFile, writeFile } from 'atomically';
import { vi } from 'vitest';
import { loadUserData, lockAppdata, unlockAppdata, saveUserData } from 'src/storage/user-data';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';
import { UserData } from '../storage-types';

const {
	getResourcesPathMock,
	getUserDataFilePathMock,
	getUserDataLockFilePathMock,
	mockElectronApp,
	mockFsExistsSync,
} = vi.hoisted( () => {
	const mockApp = {
		getPath: vi.fn().mockReturnValue( '/path/to/app/appData' ),
	};
	return {
		getResourcesPathMock: vi.fn().mockReturnValue( '/path/to/app/appData/App Name' ),
		getUserDataFilePathMock: vi
			.fn()
			.mockReturnValue( '/path/to/app/appData/App Name/appdata-v1.json' ),
		getUserDataLockFilePathMock: vi
			.fn()
			.mockReturnValue( '/path/to/app/appData/App Name/appdata-v1.json.lock' ),
		mockElectronApp: mockApp,
		mockFsExistsSync: vi.fn(),
	};
} );

vi.mock( 'electron', () => ( {
	app: mockElectronApp,
} ) );

vi.mock( 'fs', () => ( {
	default: {
		existsSync: mockFsExistsSync,
		renameSync: vi.fn(),
	},
	existsSync: mockFsExistsSync,
	renameSync: vi.fn(),
} ) );
vi.mock( 'src/storage/paths', () => ( {
	getResourcesPath: getResourcesPathMock,
	getUserDataFilePath: getUserDataFilePathMock,
	getUserDataLockFilePath: getUserDataLockFilePathMock,
} ) );

vi.mock( 'atomically', () => ( {
	readFile: vi.fn().mockResolvedValue(
		JSON.stringify( {
			sites: [
				{ name: 'Tristan', path: '/to/tristan' },
				{ name: 'Arthur', path: '/to/arthur' },
				{ name: 'Lancelot', path: '/to/lancelot' },
			],
			snapshots: [],
		} )
	),
	writeFile: vi.fn(),
} ) );

const mockedUserData: RecursivePartial< UserData > = {
	sites: [
		{ name: 'Tristan', path: '/to/tristan' },
		{ name: 'Arthur', path: '/to/arthur' },
		{ name: 'Lancelot', path: '/to/lancelot' },
	],
	snapshots: [],
};

const defaultThemeDetails = {
	name: '',
	path: '',
	slug: '',
	isBlockTheme: false,
	supportsWidgets: false,
	supportsMenus: false,
};

platformTestSuite( 'User data', () => {
	beforeEach( () => {
		// Assume each site path exists
		mockFsExistsSync.mockReturnValue( true );
		// Reset other mocks to ensure clean state
		mockElectronApp.getPath.mockReturnValue( '/path/to/app/appData' );
	} );

	afterEach( () => {
		vi.clearAllMocks();
	} );

	describe( 'loadUserData', () => {
		test( 'loads user data correctly and sorts sites', async () => {
			const result = await loadUserData();

			expect( result.sites.map( ( site ) => site.name ) ).toEqual( [
				'Arthur',
				'Lancelot',
				'Tristan',
			] );
		} );

		test( 'Filters out sites where the path does not exist', async () => {
			mockFsExistsSync.mockImplementation( ( path ) => path === '/to/lancelot' );
			const result = await loadUserData();
			expect( result.sites.map( ( sites ) => sites.name ) ).toEqual( [ 'Lancelot' ] );
		} );

		test( 'populates PHP version when unknown', async () => {
			vi.mocked( readFile ).mockResolvedValue(
				JSON.stringify( {
					sites: [
						{ name: 'Arthur', path: '/to/arthur', phpVersion: '8.3' },
						{ name: 'Lancelot', path: '/to/lancelot', phpVersion: '8.1' },
						{ name: 'Tristan', path: '/to/tristan' },
					],
					snapshots: [],
				} )
			);
			const result = await loadUserData();
			expect( result.sites.map( ( site ) => site.phpVersion ) ).toEqual( [ '8.3', '8.1', '8.0' ] );
		} );
	} );

	describe( 'saveUserData', () => {
		test( 'saves user data correctly', async () => {
			try {
				await lockAppdata();
				await saveUserData( mockedUserData as UserData );
			} finally {
				await unlockAppdata();
			}

			expect( writeFile ).toHaveBeenCalledWith(
				'/path/to/app/appData/App Name/appdata-v1.json',
				JSON.stringify(
					{
						version: 1,
						sites: mockedUserData.sites?.map( ( site ) => ( {
							...site,
							themeDetails: defaultThemeDetails,
						} ) ),
						snapshots: [],
					},
					null,
					2
				) + '\n',
				'utf-8'
			);
		} );
	} );
} );
