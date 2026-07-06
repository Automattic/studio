import { describe, expect, it, vi } from 'vitest';
import {
	getConfiguredPhpBinaryPackageId,
	getConfiguredPhpBinaryPackageVersion,
	getConfiguredPhpBinaryVersion,
	getPhpBinaryDownloadInfo,
} from '../php-binary-metadata';

vi.mock( '../php-binary-cdn-metadata.json', () => ( {
	default: {
		versions: {
			'8.4': {
				version: '8.4.22',
				packageVersion: '1.0.0',
				artifacts: {
					'win32-x64': {
						url: 'https://example.com/8.4.22-1.0.0/full-install',
						sha: 'a'.repeat( 64 ),
					},
				},
			},
		},
	},
} ) );

describe( 'PHP binary package versions', () => {
	it( 'keeps the upstream PHP version separate from the package version', () => {
		expect( getConfiguredPhpBinaryVersion( '8.4' ) ).toBe( '8.4.22' );
		expect( getConfiguredPhpBinaryPackageVersion( '8.4' ) ).toBe( '1.0.0' );
		expect( getConfiguredPhpBinaryPackageId( '8.4' ) ).toBe( '8.4.22-1.0.0' );
		expect( getPhpBinaryDownloadInfo( '8.4', 'win32', 'x64' ) ).toEqual(
			expect.objectContaining( {
				patchVersion: '8.4.22',
				packageVersion: '1.0.0',
				packageId: '8.4.22-1.0.0',
			} )
		);
	} );
} );
