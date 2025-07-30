/**
 * @jest-environment node
 */
// To run tests, execute `npm run test -- src/storage/user-data.test.ts` from the root directory
import fs from 'fs';
import { readFile, writeFile } from 'atomically';
import { loadUserData, lockAppdata, unlockAppdata, saveUserData } from 'src/storage/user-data';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';
import { UserData } from '../storage-types';

jest.mock( 'fs' );
jest.mock( 'src/storage/paths', () => ( {
	getResourcesPath: jest.fn().mockReturnValue( '/path/to/app/appData/App Name' ),
	getUserDataFilePath: jest.fn().mockReturnValue( '/path/to/app/appData/App Name/appdata-v1.json' ),
	getUserDataLockFilePath: jest
		.fn()
		.mockReturnValue( '/path/to/app/appData/App Name/appdata-v1.json.lock' ),
} ) );

jest.mock( 'atomically', () => ( {
	readFile: jest.fn().mockResolvedValue(
		JSON.stringify( {
			sites: [
				{ name: 'Tristan', path: '/to/tristan' },
				{ name: 'Arthur', path: '/to/arthur' },
				{ name: 'Lancelot', path: '/to/lancelot' },
			],
			snapshots: [],
		} )
	),
	writeFile: jest.fn(),
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
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
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
			( fs.existsSync as jest.Mock ).mockImplementation( ( path ) => path === '/to/lancelot' );
			const result = await loadUserData();
			expect( result.sites.map( ( sites ) => sites.name ) ).toEqual( [ 'Lancelot' ] );
		} );

		test( 'populates PHP version when unknown', async () => {
			( readFile as jest.Mock ).mockResolvedValue(
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
