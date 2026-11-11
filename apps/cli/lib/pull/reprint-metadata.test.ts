import { describe, expect, it, vi } from 'vitest';
import * as reprintClient from 'cli/lib/pull/reprint-client';
import { getReprintMetadata } from './reprint-metadata';

describe( 'reprint metadata', () => {
	it( 'reads the one-line metadata response from Reprint', async () => {
		vi.spyOn( reprintClient, 'runReprintCommandUntilComplete' ).mockResolvedValue( {
			stdout: JSON.stringify( {
				hasCompletedOnce: true,
				hasLocalIndex: true,
				hasSkippedFiles: false,
				pullStage: 'files-pull',
				key: {
					id: 'c1c08fadfa3a465c',
					path: '/state/remotes/abc/key.pem',
					publicKey: 'MIIBojANBg',
				},
				sourceSite: {
					homeUrl: 'https://example.com',
					siteUrl: 'https://example.com',
					tablePrefix: 'wp_',
					wordpressDatabaseCharset: null,
					serverDatabaseCharset: null,
					contentDirectory: '/srv/htdocs/wp-content',
					wordpressAbsolutePath: '/wordpress/core',
					wordpressRoots: [ 'base64:L3dvcmRwcmVzcy9jb3JlLzcuMA==', '/wordpress/core' ],
					wordpressVersion: '7.1.4',
					extraDirectories: [ '/scripts' ],
				},
			} ),
			stderr: '',
			exitCode: 0,
		} );

		const metadata = await getReprintMetadata( {
			apiUrl: 'https://example.com/?reprint-api-jetpack',
			stateDirectory: '/state',
			verbose: false,
		} );

		expect( metadata.sourceSite.contentDirectory ).toBe( '/srv/htdocs/wp-content' );
		expect( metadata.sourceSite.wordpressVersion ).toBe( '7.1.4' );
		expect( metadata.key?.publicKey ).toBe( 'MIIBojANBg' );
		expect( reprintClient.runReprintCommandUntilComplete ).toHaveBeenCalledWith(
			[ 'pull-metadata', 'https://example.com/?reprint-api-jetpack', '--state-dir=/state' ],
			undefined,
			{ verboseCommands: false }
		);
	} );

	it( 'reports no remote WordPress version from a Reprint that does not', async () => {
		vi.spyOn( reprintClient, 'runReprintCommandUntilComplete' ).mockResolvedValue( {
			stdout: JSON.stringify( {
				hasCompletedOnce: false,
				hasLocalIndex: false,
				hasSkippedFiles: false,
				pullStage: null,
				key: null,
				sourceSite: {
					homeUrl: null,
					siteUrl: null,
					wordpressDatabaseCharset: null,
					serverDatabaseCharset: null,
					contentDirectory: null,
					extraDirectories: [],
				},
			} ),
			stderr: '',
			exitCode: 0,
		} );

		const metadata = await getReprintMetadata( {
			apiUrl: 'https://example.com/?reprint-api-jetpack',
			stateDirectory: '/state',
			verbose: false,
		} );

		expect( metadata.sourceSite.wordpressVersion ).toBeNull();
	} );
} );
