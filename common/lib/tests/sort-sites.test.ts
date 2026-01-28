/**
 * @vitest-environment node
 */
// To run tests, execute `npm run test -- common/lib/tests/sort-sites.test.ts` from the root directory
import { sortSites } from 'common/lib/sort-sites';

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

	it( 'should sort sites by sortOrder when available', () => {
		const sites = [
			{ name: 'Charlie', sortOrder: 3000 },
			{ name: 'Alpha', sortOrder: 1000 },
			{ name: 'Bravo', sortOrder: 2000 },
		] as SiteDetails[];

		const sortedSites = sortSites( sites );

		expect( sortedSites.map( ( site ) => site.name ) ).toEqual( [ 'Alpha', 'Bravo', 'Charlie' ] );
	} );

	it( 'should prioritize sortOrder over name', () => {
		const sites = [
			{ name: 'Zebra', sortOrder: 1000 },
			{ name: 'Apple', sortOrder: 2000 },
		] as SiteDetails[];

		const sortedSites = sortSites( sites );

		expect( sortedSites.map( ( site ) => site.name ) ).toEqual( [ 'Zebra', 'Apple' ] );
	} );

	it( 'should sort sites with sortOrder before sites without sortOrder', () => {
		const sites = [
			{ name: 'Zebra' },
			{ name: 'Apple', sortOrder: 1000 },
			{ name: 'Beta' },
		] as SiteDetails[];

		const sortedSites = sortSites( sites );

		expect( sortedSites.map( ( site ) => site.name ) ).toEqual( [ 'Apple', 'Beta', 'Zebra' ] );
	} );

	it( 'should handle mixed sites with and without sortOrder', () => {
		const sites = [
			{ name: 'Zulu', sortOrder: 3000 },
			{ name: 'Charlie' },
			{ name: 'Alpha', sortOrder: 1000 },
			{ name: 'Bravo' },
			{ name: 'Beta', sortOrder: 2000 },
		] as SiteDetails[];

		const sortedSites = sortSites( sites );

		expect( sortedSites.map( ( site ) => site.name ) ).toEqual( [
			'Alpha',
			'Beta',
			'Zulu',
			'Bravo',
			'Charlie',
		] );
	} );
} );
