import {
	getWordPressVersionUrl,
	isWordPressDevVersion,
	isWordPressBetaVersion,
	isWordPressVersionAtLeast,
} from '../wordpress-version-utils';

describe( 'isWordPressDevVersion', () => {
	test( 'should identify WordPress development versions', () => {
		expect( isWordPressDevVersion( 'nightly' ) ).toBe( true );
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
} );

describe( 'isWordPressVersionAtLeast', () => {
	test( 'should return true when version equals minimum', () => {
		expect( isWordPressVersionAtLeast( '6.2.1', '6.2.1' ) ).toBe( true );
		expect( isWordPressVersionAtLeast( '6.4', '6.4' ) ).toBe( true );
		expect( isWordPressVersionAtLeast( '6.4.0', '6.4' ) ).toBe( true );
		expect( isWordPressVersionAtLeast( '6.4', '6.4.0' ) ).toBe( true );
	} );

	test( 'should return true when version is greater than minimum', () => {
		// Higher major version
		expect( isWordPressVersionAtLeast( '7.0', '6.2.1' ) ).toBe( true );
		expect( isWordPressVersionAtLeast( '7.0.0', '6.2.1' ) ).toBe( true );

		// Higher minor version
		expect( isWordPressVersionAtLeast( '6.4', '6.2.1' ) ).toBe( true );
		expect( isWordPressVersionAtLeast( '6.4.1', '6.2.1' ) ).toBe( true );

		// Higher patch version
		expect( isWordPressVersionAtLeast( '6.2.5', '6.2.1' ) ).toBe( true );
		expect( isWordPressVersionAtLeast( '6.4.2', '6.4.1' ) ).toBe( true );
	} );

	test( 'should return false when version is less than minimum', () => {
		// Lower major version
		expect( isWordPressVersionAtLeast( '5.9', '6.2.1' ) ).toBe( false );
		expect( isWordPressVersionAtLeast( '5.9.9', '6.2.1' ) ).toBe( false );

		// Lower minor version
		expect( isWordPressVersionAtLeast( '6.1', '6.2.1' ) ).toBe( false );
		expect( isWordPressVersionAtLeast( '6.1.9', '6.2.1' ) ).toBe( false );

		// Lower patch version
		expect( isWordPressVersionAtLeast( '6.2', '6.2.1' ) ).toBe( false );
		expect( isWordPressVersionAtLeast( '6.2.0', '6.2.1' ) ).toBe( false );
		expect( isWordPressVersionAtLeast( '6.4.1', '6.4.2' ) ).toBe( false );
	} );

	test( 'should always return true for "latest"', () => {
		expect( isWordPressVersionAtLeast( 'latest', '6.2.1' ) ).toBe( true );
		expect( isWordPressVersionAtLeast( 'latest', '5.0' ) ).toBe( true );
		expect( isWordPressVersionAtLeast( 'latest', '7.0' ) ).toBe( true );
	} );

	test( 'should compare base version for dev versions with hyphens', () => {
		// Beta versions - base version meets minimum
		expect( isWordPressVersionAtLeast( '6.3-beta1', '6.2.1' ) ).toBe( true ); // 6.3.0 >= 6.2.1
		expect( isWordPressVersionAtLeast( '6.4-beta2', '6.2.1' ) ).toBe( true ); // 6.4.0 >= 6.2.1

		// Beta versions - base version below minimum
		expect( isWordPressVersionAtLeast( '6.1-beta1', '6.2.1' ) ).toBe( false ); // 6.1.0 < 6.2.1
		expect( isWordPressVersionAtLeast( '6.2-beta1', '6.2.1' ) ).toBe( false ); // 6.2.0 < 6.2.1

		// RC versions - base version meets minimum
		expect( isWordPressVersionAtLeast( '6.3-RC1', '6.2.1' ) ).toBe( true ); // 6.3.0 >= 6.2.1
		expect( isWordPressVersionAtLeast( '6.5-RC2', '6.2.1' ) ).toBe( true ); // 6.5.0 >= 6.2.1

		// RC versions - base version below minimum
		expect( isWordPressVersionAtLeast( '6.2-RC1', '6.2.1' ) ).toBe( false ); // 6.2.0 < 6.2.1

		// Nightly/dev versions - base version meets minimum
		expect( isWordPressVersionAtLeast( '6.8-59979', '6.2.1' ) ).toBe( true ); // 6.8.0 >= 6.2.1
		expect( isWordPressVersionAtLeast( '6.8-beta2-59979', '6.2.1' ) ).toBe( true ); // 6.8.0 >= 6.2.1
		expect( isWordPressVersionAtLeast( '6.8-alpha1-12345', '6.2.1' ) ).toBe( true ); // 6.8.0 >= 6.2.1

		// Nightly/dev versions - base version below minimum
		expect( isWordPressVersionAtLeast( '6.1-59979', '6.2.1' ) ).toBe( false ); // 6.1.0 < 6.2.1
	} );

	test( 'should handle versions with different number of segments', () => {
		expect( isWordPressVersionAtLeast( '6.4', '6.2.1' ) ).toBe( true ); // 6.4.0 > 6.2.1
		expect( isWordPressVersionAtLeast( '6.2', '6.2.1' ) ).toBe( false ); // 6.2.0 < 6.2.1
		expect( isWordPressVersionAtLeast( '6.3', '6.2' ) ).toBe( true ); // 6.3.0 > 6.2.0
		expect( isWordPressVersionAtLeast( '6.2.1', '6.2' ) ).toBe( true ); // 6.2.1 > 6.2.0
	} );
} );
