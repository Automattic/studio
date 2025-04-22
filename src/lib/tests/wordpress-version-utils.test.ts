import {
	getWordPressVersionUrl,
	isWordPressDevVersion,
	isWordPressBetaVersion,
} from '../wordpress-version-utils';

describe( 'isWordPressDevVersion', () => {
	test( 'should identify WordPress development versions', () => {
		expect( isWordPressDevVersion( '6.8-beta2-59979' ) ).toBe( true );
		expect( isWordPressDevVersion( '6.8-59979' ) ).toBe( true );
		expect( isWordPressDevVersion( '6.8.3-59979' ) ).toBe( true );
		expect( isWordPressDevVersion( '6.8-alpha1-12345' ) ).toBe( true );
		expect( isWordPressDevVersion( '6.8-RC1-59979' ) ).toBe( true );
	} );

	test( 'should return false for regular WordPress versions', () => {
		expect( isWordPressDevVersion( '6.2' ) ).toBe( false );
		expect( isWordPressDevVersion( '6.2.1' ) ).toBe( false );
		expect( isWordPressDevVersion( '6.3-beta1' ) ).toBe( false );
		expect( isWordPressDevVersion( '6.3-RC1' ) ).toBe( false );
	} );

	test( 'should return false for invalid or empty versions', () => {
		expect( isWordPressDevVersion( '' ) ).toBe( false );
		expect( isWordPressDevVersion( 'latest' ) ).toBe( false );
		expect( isWordPressDevVersion( '6.8-beta2' ) ).toBe( false );
		expect( isWordPressDevVersion( '6.8-ABCD' ) ).toBe( false );
		expect( isWordPressDevVersion( 'not-a-version' ) ).toBe( false );
	} );
} );

describe( 'isWordPressBetaVersion', () => {
	test( 'should identify beta and RC versions', () => {
		// Beta versions
		expect( isWordPressBetaVersion( '6.3-beta1' ) ).toBe( true );
		expect( isWordPressBetaVersion( '6.3-beta2' ) ).toBe( true );
		expect( isWordPressBetaVersion( '6.3.1-beta1' ) ).toBe( true );

		// RC versions
		expect( isWordPressBetaVersion( '6.3-RC1' ) ).toBe( true );
		expect( isWordPressBetaVersion( '6.3-RC2' ) ).toBe( true );
		expect( isWordPressBetaVersion( '6.3.1-RC1' ) ).toBe( true );

		// Dev versions with beta/RC
		expect( isWordPressBetaVersion( '6.8-beta2-59979' ) ).toBe( true );
		expect( isWordPressBetaVersion( '6.8-RC1-59979' ) ).toBe( true );
	} );

	test( 'should return false for non-beta/RC versions', () => {
		// Regular versions
		expect( isWordPressBetaVersion( '6.2' ) ).toBe( false );
		expect( isWordPressBetaVersion( '6.2.1' ) ).toBe( false );

		// Alpha and other dev versions
		expect( isWordPressBetaVersion( '6.8-alpha1-12345' ) ).toBe( false );
		expect( isWordPressBetaVersion( '6.8-59979' ) ).toBe( false );
	} );

	test( 'should return false for invalid or empty versions', () => {
		expect( isWordPressBetaVersion( '' ) ).toBe( false );
		expect( isWordPressBetaVersion( 'latest' ) ).toBe( false );
		expect( isWordPressBetaVersion( '6.8-ABCD' ) ).toBe( false );
		expect( isWordPressBetaVersion( 'not-a-version' ) ).toBe( false );
	} );
} );

describe( 'getWordPressVersionUrl', () => {
	test( 'should return nightly build URL for development versions', () => {
		expect( getWordPressVersionUrl( '6.8-59979' ) ).toBe(
			'https://wordpress.org/nightly-builds/wordpress-latest.zip'
		);
		expect( getWordPressVersionUrl( '6.9-12345' ) ).toBe(
			'https://wordpress.org/nightly-builds/wordpress-latest.zip'
		);
		expect( getWordPressVersionUrl( '6.8-beta3-600046' ) ).toBe(
			'https://wordpress.org/nightly-builds/wordpress-latest.zip'
		);
		expect( getWordPressVersionUrl( '6.8-RC1-59979' ) ).toBe(
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
