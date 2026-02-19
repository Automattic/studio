import { getSiteUrl } from 'src/lib/get-site-url';

describe( 'getSiteUrl', () => {
	it( 'should return custom domain URL when customDomain is provided', () => {
		const site: SiteDetails = {
			customDomain: 'example.wp.local',
			port: 8080,
		} as SiteDetails;

		const result = getSiteUrl( site );
		expect( result ).toBe( 'http://example.wp.local' );
	} );

	it( 'should return localhost URL when no custom domain is provided', () => {
		const site: SiteDetails = {
			port: 8080,
		} as SiteDetails;

		const result = getSiteUrl( site );
		expect( result ).toBe( 'http://localhost:8080' );
	} );
} );
