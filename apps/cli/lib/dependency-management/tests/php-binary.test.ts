import {
	resolveNativePhpVersion,
	getConfiguredPhpBinaryPackageId,
	getConfiguredPhpBinaryPackageVersion,
	getConfiguredPhpBinaryVersion,
	getPhpBinaryDownloadInfo,
} from '@studio/common/lib/php-binary-metadata';
import { describe, expect, it } from 'vitest';
import { resolvePhpBinaryDownloadInfo } from 'cli/lib/dependency-management/php-binary';

describe( 'getPhpBinaryDownloadInfo', () => {
	it( 'uses checked-in CDN metadata for a matching URL and SHA', () => {
		expect( getPhpBinaryDownloadInfo( '8.4', 'darwin', 'arm64' ) ).toEqual(
			expect.objectContaining( {
				patchVersion: getConfiguredPhpBinaryVersion( '8.4' ),
				packageId: getConfiguredPhpBinaryPackageId( '8.4' ),
				packageVersion: getConfiguredPhpBinaryPackageVersion( '8.4' ),
				url: expect.stringContaining( '/downloads/wordpress-com-studio-php-cli/mac-silicon/' ),
				sha: expect.stringMatching( /^[a-f0-9]{64}$/ ),
			} )
		);
	} );

	it( 'uses the Windows x64 CDN binary on Windows ARM64', () => {
		expect( getPhpBinaryDownloadInfo( '8.4', 'win32', 'arm64' ) ).toEqual(
			expect.objectContaining( {
				patchVersion: getConfiguredPhpBinaryVersion( '8.4' ),
				packageId: getConfiguredPhpBinaryPackageId( '8.4' ),
				packageVersion: getConfiguredPhpBinaryPackageVersion( '8.4' ),
				url: expect.stringContaining( '/downloads/wordpress-com-studio-php-cli/windows-x64/' ),
				sha: expect.stringMatching( /^[a-f0-9]{64}$/ ),
			} )
		);
	} );

	it( 'returns the configured patch version for a PHP minor', () => {
		expect( getConfiguredPhpBinaryVersion( '8.4' ) ).toMatch( /^\d+\.\d+\.\d+$/ );
	} );

	it( 'returns a package ID composed from the PHP patch and optional package version', () => {
		const patchVersion = getConfiguredPhpBinaryVersion( '8.4' );
		const packageVersion = getConfiguredPhpBinaryPackageVersion( '8.4' );

		expect( getConfiguredPhpBinaryPackageId( '8.4' ) ).toBe(
			packageVersion ? `${ patchVersion }-${ packageVersion }` : patchVersion
		);
	} );

	it( 'returns undefined when metadata is missing for the platform', () => {
		expect( getPhpBinaryDownloadInfo( '8.4', 'aix', 'x64' ) ).toBeUndefined();
	} );

	it( 'resolves older supported PHP versions to the closest native PHP version', () => {
		expect( resolveNativePhpVersion( '8.0' ) ).toBe( '8.2' );
	} );
} );

describe( 'resolvePhpBinaryDownloadInfo', () => {
	it( 'rejects with a user-facing unavailable message', async () => {
		await expect( resolvePhpBinaryDownloadInfo( '8.4', 'aix', 'x64' ) ).rejects.toThrow(
			'PHP 8.4 is not available for this platform yet.'
		);
	} );
} );
