import { PHP_BINARY_MANIFEST_URL } from '@studio/common/lib/php-binary-metadata';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePhpBinaryDownloadInfo } from 'cli/lib/dependency-management/php-binary';

const nockFetch = require( 'isomorphic-fetch' ) as typeof fetch;
const manifestUrl = new URL( PHP_BINARY_MANIFEST_URL );

function mockManifest( json: Record< string, unknown > ): void {
	nock( manifestUrl.origin ).get( manifestUrl.pathname ).reply( 200, json );
}

describe( 'resolvePhpBinaryDownloadInfo', () => {
	beforeEach( () => {
		vi.stubGlobal( 'fetch', nockFetch );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'uses the Apps CDN manifest when it has a matching URL and SHA', async () => {
		const sha = 'a'.repeat( 64 );
		const url = 'https://appscdn.wordpress.com/builds/wordpress-com-studio-php-cli/example.zip';

		mockManifest( {
			'8.4.20': {
				darwin: {
					arm64: { url, sha, size: 123 },
				},
			},
		} );

		await expect( resolvePhpBinaryDownloadInfo( '8.4', 'darwin', 'arm64' ) ).resolves.toEqual( {
			patchVersion: '8.4.20',
			url,
			sha,
			size: 123,
		} );
	} );

	it( 'uses the latest matching PHP patch from the Apps CDN manifest', async () => {
		const oldSha = 'a'.repeat( 64 );
		const latestSha = 'b'.repeat( 64 );
		const oldUrl = 'https://appscdn.wordpress.com/builds/wordpress-com-studio-php-cli/old.zip';
		const latestUrl =
			'https://appscdn.wordpress.com/builds/wordpress-com-studio-php-cli/latest.zip';

		mockManifest( {
			'8.4.20': {
				darwin: {
					arm64: { url: oldUrl, sha: oldSha },
				},
			},
			'8.4.21': {
				darwin: {
					arm64: { url: latestUrl, sha: latestSha },
				},
			},
			'8.3.30': {
				darwin: {
					arm64: { url: oldUrl, sha: oldSha },
				},
			},
		} );

		await expect( resolvePhpBinaryDownloadInfo( '8.4', 'darwin', 'arm64' ) ).resolves.toEqual( {
			patchVersion: '8.4.21',
			url: latestUrl,
			sha: latestSha,
		} );
	} );

	it( 'uses the Windows x64 Apps CDN binary on Windows ARM64', async () => {
		const sha = 'b'.repeat( 64 );
		const url = 'https://appscdn.wordpress.com/builds/wordpress-com-studio-php-cli/example.zip';

		mockManifest( {
			'8.4.20': {
				win32: {
					x64: { url, sha },
				},
			},
		} );

		await expect( resolvePhpBinaryDownloadInfo( '8.4', 'win32', 'arm64' ) ).resolves.toEqual( {
			patchVersion: '8.4.20',
			url,
			sha,
		} );
	} );

	it( 'rejects when the manifest is missing a SHA', async () => {
		mockManifest( {
			'8.4.20': {
				darwin: {
					arm64: { url: 'https://appscdn.wordpress.com/example.zip' },
				},
			},
		} );

		await expect( resolvePhpBinaryDownloadInfo( '8.4', 'darwin', 'arm64' ) ).rejects.toThrow(
			'PHP 8.4 is not available for this device yet. Please try again later.'
		);
	} );

	it( 'rejects when the manifest cannot be fetched', async () => {
		await expect( resolvePhpBinaryDownloadInfo( '8.4', 'darwin', 'arm64' ) ).rejects.toThrow(
			'Could not check PHP availability. Please try again later.'
		);
	} );
} );
