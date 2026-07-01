import { normalizeLandingPage } from '../landing-page';

describe( 'normalizeLandingPage', () => {
	it( 'returns undefined for non-string values', () => {
		expect( normalizeLandingPage( undefined ) ).toBeUndefined();
		expect( normalizeLandingPage( null ) ).toBeUndefined();
		expect( normalizeLandingPage( 42 ) ).toBeUndefined();
		expect( normalizeLandingPage( {} ) ).toBeUndefined();
	} );

	it( 'returns undefined for empty or whitespace-only strings', () => {
		expect( normalizeLandingPage( '' ) ).toBeUndefined();
		expect( normalizeLandingPage( '   ' ) ).toBeUndefined();
	} );

	it( 'preserves an absolute path as-is', () => {
		expect( normalizeLandingPage( '/wp-admin/' ) ).toBe( '/wp-admin/' );
	} );

	it( 'preserves query string and hash on a path', () => {
		expect( normalizeLandingPage( '/?page_id=2' ) ).toBe( '/?page_id=2' );
		expect( normalizeLandingPage( '/wp-admin/post.php?post=1&action=edit' ) ).toBe(
			'/wp-admin/post.php?post=1&action=edit'
		);
		expect( normalizeLandingPage( '/page#section' ) ).toBe( '/page#section' );
	} );

	it( 'prepends a leading slash to a relative path', () => {
		expect( normalizeLandingPage( 'wp-admin/' ) ).toBe( '/wp-admin/' );
		expect( normalizeLandingPage( 'about' ) ).toBe( '/about' );
	} );

	it( 'strips host from a fully-qualified URL', () => {
		expect( normalizeLandingPage( 'https://example.com/wp-admin/' ) ).toBe( '/wp-admin/' );
		expect( normalizeLandingPage( 'http://localhost:8881/wp-admin/post.php?post=1' ) ).toBe(
			'/wp-admin/post.php?post=1'
		);
	} );
} );
