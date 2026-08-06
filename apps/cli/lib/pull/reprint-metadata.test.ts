import { describe, expect, it, vi } from 'vitest';
import * as migrationClient from 'cli/lib/pull/migration-client';
import { getCoreRoots, getReprintMetadata } from './reprint-metadata';

describe( 'reprint metadata', () => {
	it( 'reads the one-line metadata response from Reprint', async () => {
		vi.spyOn( migrationClient, 'runReprintCommandUntilComplete' ).mockResolvedValue( {
			stdout: JSON.stringify( {
				hasCompletedOnce: true,
				hasLocalIndex: true,
				hasSkippedFiles: false,
				pullStage: 'files-pull',
				sourceSite: {
					homeUrl: 'https://example.com',
					siteUrl: 'https://example.com',
					tablePrefix: 'wp_',
					wordpressDatabaseCharset: null,
					serverDatabaseCharset: null,
					contentDirectory: '/srv/htdocs/wp-content',
					wordpressAbsolutePath: '/wordpress/core',
					wordpressRoots: [ 'base64:L3dvcmRwcmVzcy9jb3JlLzcuMA==', '/wordpress/core' ],
					extraDirectories: [ '/scripts' ],
				},
			} ),
			stderr: '',
			exitCode: 0,
		} );

		const metadata = await getReprintMetadata( {
			apiUrl: 'https://example.com/?reprint-api',
			stateDirectory: '/state',
			rawDirectory: '/raw',
			runtime: 'native-php',
			verbose: false,
		} );

		expect( getCoreRoots( metadata ) ).toEqual( [ '/wordpress/core/7.0' ] );
		expect( migrationClient.runReprintCommandUntilComplete ).toHaveBeenCalledWith(
			'/state',
			'/raw',
			[ 'import-metadata', 'https://example.com/?reprint-api', '--state-dir=/state' ],
			undefined,
			expect.any( Object )
		);
	} );
} );
