import { describe, expect, it, vi } from 'vitest';
import {
	getConfiguredPhpBinaryPackageId,
	getConfiguredPhpBinaryPackageVersion,
	getConfiguredPhpBinaryVersion,
	getPhpBinaryDownloadInfo,
	NativePhpSupportedVersions,
	resolveNativePhpVersion,
	validateNativePhpVersion,
} from '../php-binary-metadata';

vi.mock( '../php-binary-cdn-metadata.mjs', () => ( {
	default: {
		versions: {
			'8.4': {
				version: '8.4.22',
				packageVersion: 'studio-1',
				artifacts: {
					'win32-x64': {
						url: 'https://example.com/8.4.22-studio-1/full-install',
						sha: 'a'.repeat( 64 ),
					},
				},
			},
		},
	},
} ) );

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

	it( 'keeps the upstream PHP version separate from the package version', () => {
		expect( getConfiguredPhpBinaryVersion( '8.4' ) ).toBe( '8.4.22' );
		expect( getConfiguredPhpBinaryPackageVersion( '8.4' ) ).toBe( 'studio-1' );
		expect( getConfiguredPhpBinaryPackageId( '8.4' ) ).toBe( '8.4.22-studio-1' );
		expect( getPhpBinaryDownloadInfo( '8.4', 'win32', 'x64' ) ).toEqual(
			expect.objectContaining( {
				patchVersion: '8.4.22',
				packageVersion: 'studio-1',
				packageId: '8.4.22-studio-1',
			} )
		);
	} );
} );
