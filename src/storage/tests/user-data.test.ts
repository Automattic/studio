/**
 * @jest-environment node
 */
// To run tests, execute `npm run test -- src/storage/user-data.test.ts` from the root directory
import fs from 'fs';
import { loadUserData } from '../user-data';

jest.mock( 'fs' );

const mockUserData = {
	sites: [
		{ name: 'Tristan', path: '/to/tristan' },
		{ name: 'Arthur', path: '/to/arthur' },
		{ name: 'Lancelot', path: '/to/lancelot' },
	],
	snapshots: [],
};

( fs as MockedFs ).__setFileContents(
	'/path/to/app/appData/App Name/appdata-v1.json',
	JSON.stringify( mockUserData )
);
// Assume each site path exists
( fs.existsSync as jest.Mock ).mockReturnValue( true );

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
} );
