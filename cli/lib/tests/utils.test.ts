import { normalizeHostname } from 'cli/lib/utils';

describe( 'normalizeHostname', () => {
	it( 'should normalize a basic hostname', () => {
		expect( normalizeHostname( 'example.com' ) ).toBe( 'example.com' );
	} );

	it( 'should remove http protocol', () => {
		expect( normalizeHostname( 'http://example.com' ) ).toBe( 'example.com' );
	} );

	it( 'should remove https protocol', () => {
		expect( normalizeHostname( 'https://example.com' ) ).toBe( 'example.com' );
	} );

	it( 'should remove trailing slash', () => {
		expect( normalizeHostname( 'example.com/' ) ).toBe( 'example.com' );
	} );

	it( 'should convert to lowercase', () => {
		expect( normalizeHostname( 'EXAMPLE.COM' ) ).toBe( 'example.com' );
	} );

	it( 'should trim whitespace', () => {
		expect( normalizeHostname( '  example.com  ' ) ).toBe( 'example.com' );
	} );

	it( 'should handle multiple transformations', () => {
		expect( normalizeHostname( '  HTTPS://EXAMPLE.COM/  ' ) ).toBe( 'example.com' );
	} );
} );
