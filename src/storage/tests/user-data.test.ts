/**
 * @jest-environment node
 */
// To run tests, execute `npm run test -- src/storage/user-data.test.ts` from the root directory
import fs from 'fs';
import { getUserDataFilePath } from '../paths';
import { UserData } from '../storage-types';
import { loadUserData, saveUserData } from '../user-data';

jest.mock( 'fs' );
jest.mock( '../paths' );

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

function mockUserData( data: RecursivePartial< UserData > ) {
	( fs as MockedFs ).__setFileContents(
		'/path/to/app/appData/App Name/appdata-v1.json',
		JSON.stringify( data )
	);
}

beforeEach( () => {
	mockUserData( mockedUserData );
	// Assume each site path exists
	( fs.existsSync as jest.Mock ).mockReturnValue( true );
	( getUserDataFilePath as jest.Mock ).mockReturnValue(
		'/path/to/app/appData/App Name/appdata-v1.json'
	);
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
		mockUserData( {
			sites: [
				{ name: 'Arthur', path: '/to/arthur', phpVersion: '8.3' },
				{ name: 'Lancelot', path: '/to/lancelot', phpVersion: '8.1' },
				{ name: 'Tristan', path: '/to/tristan' },
			],
			snapshots: [],
		} );
		const result = await loadUserData();
		expect( result.sites.map( ( site ) => site.phpVersion ) ).toEqual( [ '8.3', '8.1', '8.0' ] );
	} );
} );

describe( 'saveUserData', () => {
	test( 'saves user data correctly', async () => {
		await saveUserData( mockedUserData as UserData );
		expect( fs.promises.writeFile ).toHaveBeenCalledWith(
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
