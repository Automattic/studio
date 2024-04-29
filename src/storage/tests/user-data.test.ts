// To run tests, execute `npm run test -- src/storage/user-data.test.ts` from the root directory
import fs from 'fs';
import { loadUserData } from '../user-data';

const mockUserData = {
	sites: [
		{ name: 'Tristan', path: '/to/tristan' },
		{ name: 'Arthur', path: '/to/arthur' },
		{ name: 'Lancelot', path: '/to/lancelot' },
	],
	snapshots: [],
};

jest.mock( 'fs', () => ( {
	promises: {
		readFile: async () => JSON.stringify( mockUserData ),
	},
	existsSync: () => true,
} ) );

jest.mock( 'path', () => ( {
	join: jest.fn(),
} ) );

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
		fs.existsSync = jest.fn( ( path ) => path === '/to/lancelot' );
		const result = await loadUserData();
		expect( result.sites.map( ( sites ) => sites.name ) ).toEqual( [ 'Lancelot' ] );
	} );
} );
