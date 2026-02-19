import { addUrlParams, getHostnameFromUrl } from 'src/lib/url-utils';

describe( 'getHostnameFromUrl', () => {
	it( 'extracts hostname from valid URLs', () => {
		expect( getHostnameFromUrl( 'https://telex.automattic.ai/' ) ).toBe( 'telex.automattic.ai' );
		expect( getHostnameFromUrl( 'https://wordpress.com/path' ) ).toBe( 'wordpress.com' );
		expect( getHostnameFromUrl( 'http://localhost:3000' ) ).toBe( 'localhost' );
	} );

	it( 'returns original string for invalid URLs', () => {
		expect( getHostnameFromUrl( 'not-a-url' ) ).toBe( 'not-a-url' );
		expect( getHostnameFromUrl( '' ) ).toBe( '' );
	} );
} );

describe( 'addUrlParams', () => {
	it( 'adds params to a URL', () => {
		const result = addUrlParams( 'https://example.com/', { foo: 'bar', baz: 'qux' } );
		expect( result ).toContain( 'foo=bar' );
		expect( result ).toContain( 'baz=qux' );
	} );

	it( 'preserves existing path', () => {
		const result = addUrlParams( 'https://example.com/some/path', { foo: 'bar' } );
		expect( result ).toContain( '/some/path' );
		expect( result ).toContain( 'foo=bar' );
	} );

	it( 'preserves existing query params', () => {
		const result = addUrlParams( 'https://example.com/?existing=param', { foo: 'bar' } );
		expect( result ).toContain( 'existing=param' );
		expect( result ).toContain( 'foo=bar' );
	} );

	it( 'preserves existing hash', () => {
		const result = addUrlParams( 'https://example.com/#section', { foo: 'bar' } );
		expect( result ).toContain( '#section' );
		expect( result ).toContain( 'foo=bar' );
	} );

	it( 'does not override existing params', () => {
		const result = addUrlParams( 'https://example.com/?foo=existing', { foo: 'new', bar: 'baz' } );
		expect( result ).toContain( 'foo=existing' );
		expect( result ).not.toContain( 'foo=new' );
		expect( result ).toContain( 'bar=baz' );
	} );

	it( 'returns invalid URLs unchanged', () => {
		expect( addUrlParams( 'not-a-url', { foo: 'bar' } ) ).toBe( 'not-a-url' );
		expect( addUrlParams( '', { foo: 'bar' } ) ).toBe( '' );
	} );
} );
