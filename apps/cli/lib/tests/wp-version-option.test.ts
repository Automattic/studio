import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { ValidationError } from 'cli/lib/validation-error';
import {
	CLI_AUTO_UPDATE_WP_VERSION,
	coerceWpVersionOption,
	normalizeCliWpVersion,
} from 'cli/lib/wp-version-option';

describe( 'normalizeCliWpVersion', () => {
	it( 'resolves the auto-update alias to the internal mode value', () => {
		expect( normalizeCliWpVersion( CLI_AUTO_UPDATE_WP_VERSION ) ).toBe( DEFAULT_WORDPRESS_VERSION );
	} );

	it( 'passes every other value through untouched', () => {
		for ( const value of [ 'latest', 'nightly', '6.4', '6.4.1', '6.4-beta1' ] ) {
			expect( normalizeCliWpVersion( value ) ).toBe( value );
		}
	} );
} );

describe( 'coerceWpVersionOption', () => {
	it( 'accepts the auto-update value and returns the internal mode', () => {
		expect( coerceWpVersionOption( CLI_AUTO_UPDATE_WP_VERSION ) ).toBe( DEFAULT_WORDPRESS_VERSION );
	} );

	it( 'still accepts `latest`, so existing scripts keep working', () => {
		expect( coerceWpVersionOption( 'latest' ) ).toBe( DEFAULT_WORDPRESS_VERSION );
	} );

	it( 'accepts pinned versions and nightly', () => {
		expect( coerceWpVersionOption( '6.4.1' ) ).toBe( '6.4.1' );
		expect( coerceWpVersionOption( 'nightly' ) ).toBe( 'nightly' );
	} );

	it( 'rejects an unknown value', () => {
		expect( () => coerceWpVersionOption( 'auto' ) ).toThrow( ValidationError );
	} );

	it( 'rejects a version below the supported minimum', () => {
		expect( () => coerceWpVersionOption( '4.9' ) ).toThrow( ValidationError );
	} );

	it( 'reports the value the user typed, not the resolved one', () => {
		expect( () => coerceWpVersionOption( 'auto-updates' ) ).toThrow( /auto-updates/ );
	} );
} );
