import { SITE_RUNTIME_NATIVE_PHP } from '@studio/common/lib/site-runtime';
import { vi } from 'vitest';
import { runReprintCommandUntilComplete } from 'cli/lib/pull/migration-client';
import { readReprintImportMetadata } from 'cli/lib/pull/reprint-metadata';

vi.mock( 'cli/lib/pull/migration-client', () => ( {
	runReprintCommandUntilComplete: vi.fn(),
} ) );

describe( 'reprint import metadata', () => {
	it( 'reads metadata through the Reprint command', async () => {
		const metadata = {
			hasCompletedOnce: false,
			hasLocalIndex: true,
			hasSkippedFiles: false,
			pullStage: 'files',
			sourceSite: {
				homeUrl: 'https://example.com',
				siteUrl: 'https://example.com/wordpress',
				tablePrefix: 'wp_',
				wordpressDatabaseCharset: 'utf8mb4',
				serverDatabaseCharset: 'utf8mb4',
				contentDirectory: '/srv/htdocs/wp-content',
				wordpressAbsolutePath: '/wordpress/core/7.0',
				wordpressRoots: [ '/wordpress/core/7.0' ],
				extraDirectories: [ '/scripts' ],
			},
		};
		vi.mocked( runReprintCommandUntilComplete ).mockResolvedValue( {
			stdout: JSON.stringify( metadata ),
			stderr: '',
			exitCode: 0,
		} );

		await expect( readReprintImportMetadata( '/pull/state', '/pull/raw' ) ).resolves.toEqual(
			metadata
		);
		expect( runReprintCommandUntilComplete ).toHaveBeenCalledWith(
			'/pull/state',
			'/pull/raw',
			[ 'import-metadata', '--state-dir=/pull/state' ],
			undefined,
			{ runtime: SITE_RUNTIME_NATIVE_PHP }
		);
	} );
} );
