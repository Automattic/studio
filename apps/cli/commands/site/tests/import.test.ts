import {
	findMatchingWpComSite,
	formatWpComSitesList,
	getImportKey,
	inferSiteNameFromUrl,
	normalizeImportUrl,
} from '../import';

describe( 'CLI: studio site import helpers', () => {
	it( 'normalizes URLs by stripping hashes and trailing slashes', () => {
		expect( normalizeImportUrl( 'https://example.com/foo//#section' ) ).toBe(
			'https://example.com/foo'
		);
	} );

	it( 'infers the default site name from the URL host only', () => {
		expect( inferSiteNameFromUrl( 'https://subdomain.example.com/path/to/site?foo=bar' ) ).toBe(
			'subdomain.example.com'
		);
	} );

	it( 'reuses the same import key for unnamed imports of the same normalized URL', () => {
		expect( getImportKey( 'https://example.com/', undefined ) ).toBe(
			getImportKey( 'https://example.com/', undefined )
		);
		expect( getImportKey( 'https://example.com/', 'Explicit Name' ) ).not.toBe(
			getImportKey( 'https://example.com/', undefined )
		);
	} );

	it( 'matches WordPress.com sites by normalized URL or host', () => {
		expect(
			findMatchingWpComSite(
				[
					{
						id: 1,
						name: 'Example',
						url: 'https://example.wordpress.com/',
					},
				],
				'https://example.wordpress.com'
			)
		).toEqual( {
			id: 1,
			name: 'Example',
			url: 'https://example.wordpress.com/',
		} );
	} );

	it( 'formats the truncated WordPress.com site list with a full-list hint', () => {
		expect(
			formatWpComSitesList(
				[
					{ id: 1, name: 'One', url: 'https://one.wordpress.com' },
					{ id: 2, name: 'Two', url: 'https://two.wordpress.com' },
				],
				1
			)
		).toContain( '--list-wpcom-sites' );
	} );
} );
