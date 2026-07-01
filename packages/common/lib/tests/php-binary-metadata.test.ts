import { describe, expect, it } from 'vitest';
import {
	NativePhpSupportedVersions,
	resolveNativePhpVersion,
	validateNativePhpVersion,
} from '@studio/common/lib/php-binary-metadata';

describe( 'Native PHP binary metadata', () => {
	it( 'supports officially supported PHP versions', () => {
		expect( NativePhpSupportedVersions ).toEqual( [ '8.5', '8.4', '8.3', '8.2' ] );
	} );

	it.each( [ '8.1', '8.0', '7.4' ] )( 'rejects unsupported PHP %s', ( version ) => {
		expect( () => validateNativePhpVersion( version ) ).toThrow(
			`PHP ${ version } is not supported by the native-php runtime. Supported versions: 8.5, 8.4, 8.3, 8.2.`
		);
	} );

	it.each( [
		[ '8.1', '8.2' ],
		[ '8.0', '8.2' ],
		[ '7.4', '8.2' ],
		[ '8.6', '8.5' ],
		[ '', '8.5' ],
	] )( 'resolves PHP %s to native PHP %s', ( version, expectedVersion ) => {
		expect( resolveNativePhpVersion( version ) ).toBe( expectedVersion );
	} );

	it( 'rejects malformed PHP versions when resolving native PHP', () => {
		expect( () => resolveNativePhpVersion( 'nonsense' ) ).toThrow(
			'PHP nonsense is not supported by the native-php runtime.'
		);
	} );
} );
