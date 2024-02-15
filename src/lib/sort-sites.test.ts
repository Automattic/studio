// To run tests, execute `npm run test -- src/lib/sort-sites.test.ts` from the root directory
import { sortSites } from './sort-sites';

describe( 'sortSites', () => {
	it( 'should sort sites by name in ascending order', () => {
		const sites = [
			{ name: 'Tristan' },
			{ name: 'Arthur' },
			{ name: 'Lancelot' },
		] as SiteDetails[];

		const sortedSites = sortSites( sites );

		expect( sortedSites.map( ( site ) => site.name ) ).toEqual( [
			'Arthur',
			'Lancelot',
			'Tristan',
		] );
	} );
} );
