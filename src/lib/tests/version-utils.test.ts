import { isWordPressDevVersion } from '../version-utils';

describe( 'isWordPressDevVersion', () => {
	test( 'should identify WordPress development versions', () => {
		expect( isWordPressDevVersion( '6.8-beta2-59979' ) ).toBe( true );
	} );

	test( 'should return false for regular WordPress versions', () => {
		expect( isWordPressDevVersion( '6.2' ) ).toBe( false );
		expect( isWordPressDevVersion( '6.2.1' ) ).toBe( false );
		expect( isWordPressDevVersion( '6.3-beta1' ) ).toBe( false );
	} );

	test( 'should return false for invalid or empty versions', () => {
		expect( isWordPressDevVersion( '' ) ).toBe( false );
		expect( isWordPressDevVersion( 'latest' ) ).toBe( false );
		expect( isWordPressDevVersion( '6.8-beta2' ) ).toBe( false );
		expect( isWordPressDevVersion( '6.8-59979' ) ).toBe( false );
	} );
} );
