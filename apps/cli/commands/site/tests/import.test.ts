import {
	findMatchingWpComSite,
	formatWpComSitesList,
	getApiUrl,
	getImportKey,
	inferSiteNameFromUrl,
	normalizeImportUrl,
	parseImporterJson,
} from '../import';

describe( 'CLI: studio site import helpers', () => {
	it( 'normalizes URLs by stripping hashes and trailing slashes', () => {
		expect( normalizeImportUrl( 'https://example.com/foo//#section' ) ).toBe(
			'https://example.com/foo'
		);
	} );

	it( 'accepts a bare domain and defaults it to https', () => {
		expect( normalizeImportUrl( 'example.com/foo' ) ).toBe( 'https://example.com/foo' );
	} );

	it( 'strips the site export API marker from the canonical site URL', () => {
		expect( normalizeImportUrl( 'https://example.com/?site-export-api' ) ).toBe(
			'https://example.com/'
		);
	} );

	it( 'adds the site export API marker exactly once to the importer URL', () => {
		expect( getApiUrl( normalizeImportUrl( 'https://example.com/?site-export-api' ) ) ).toBe(
			'https://example.com/?site-export-api'
		);
	} );

	it( 'parses the final JSON envelope from a JSON stream on stdout', () => {
		expect(
			parseImporterJson( {
				stdout:
					'{"debug":"Waiting for server response..."}\n' +
					'{\n  "ok": true,\n  "data": {\n    "protocol_version": 1\n  }\n}',
				stderr: '',
			} as never )
		).toEqual( {
			ok: true,
			data: {
				protocol_version: 1,
			},
		} );
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
