import { buildStudioActionLink, parseStudioActionLink } from 'src/lib/deeplink/studio-action-link';

describe( 'Studio action links', () => {
	it( 'round-trips the new site action', () => {
		expect( parseStudioActionLink( buildStudioActionLink( { action: 'new-site' } ) ) ).toEqual( {
			action: 'new-site',
		} );
	} );

	it( 'keeps site identifiers separate from URL syntax', () => {
		const target = { action: 'open-site' as const, siteId: 'a/b?c&d=é #1' };
		expect( parseStudioActionLink( buildStudioActionLink( target ) ) ).toEqual( target );
	} );

	it.each( [
		'not a URL',
		'https://app/v1/new-site',
		'wp-studio://other/v1/new-site',
		'wp-studio://user@app/v1/new-site',
		'wp-studio://app/v2/new-site',
		'wp-studio://app/v1/new-site?unexpected=1',
		'wp-studio://app/v1/open-site',
		'wp-studio://app/v1/open-site?id=',
		'wp-studio://app/v1/open-site?id=%20',
		'wp-studio://app/v1/open-site?id=one&id=two',
		'wp-studio://app/v1/open-site?id=one#fragment',
	] )( 'ignores invalid action links: %s', ( value ) => {
		expect( parseStudioActionLink( value ) ).toBeNull();
	} );
} );
