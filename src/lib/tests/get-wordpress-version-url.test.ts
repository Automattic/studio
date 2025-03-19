import { getWordPressVersionUrl } from '../get-wordpress-version-url';

describe( 'getWordPressVersionUrl', () => {
	test( 'should return nightly build URL for development versions', () => {
		expect( getWordPressVersionUrl( '6.8-beta2-59979' ) ).toBe(
			'https://wordpress.org/nightly-builds/wordpress-latest.zip'
		);
		expect( getWordPressVersionUrl( '6.9-alpha1-12345' ) ).toBe(
			'https://wordpress.org/nightly-builds/wordpress-latest.zip'
		);
	} );

	test( 'should return correct URL for normal versions', () => {
		expect( getWordPressVersionUrl( '6.2' ) ).toBe( 'https://wordpress.org/wordpress-6.2.zip' );
		expect( getWordPressVersionUrl( '6.2.1' ) ).toBe( 'https://wordpress.org/wordpress-6.2.1.zip' );
		expect( getWordPressVersionUrl( '6.3-beta1' ) ).toBe(
			'https://wordpress.org/wordpress-6.3-beta1.zip'
		);
	} );

	test( 'should throw error for invalid versions', () => {
		expect( () => getWordPressVersionUrl( 'invalid' ) ).toThrow(
			'Unrecognized WordPress version. Please use "latest" or numeric versions such as "6.2", "6.0.1", "6.2-beta1", or "6.2-RC1"'
		);
		expect( () => getWordPressVersionUrl( '6.invalid' ) ).toThrow();
		expect( () => getWordPressVersionUrl( '' ) ).toThrow();
	} );

	test( 'should use default version when none provided', () => {
		expect( () => getWordPressVersionUrl() ).not.toThrow();
	} );
} );
