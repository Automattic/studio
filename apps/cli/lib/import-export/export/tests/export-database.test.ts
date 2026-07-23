import { Readable } from 'node:stream';
import { vi } from 'vitest';
import { runWpCliCommand, WpCliResponse } from 'cli/lib/run-wp-cli-command';
import { exportDatabaseToFile, exportDatabaseToMultipleFiles } from '../export-database';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/run-wp-cli-command', async () => {
	const actual = await vi.importActual( 'cli/lib/run-wp-cli-command' );
	return {
		...actual,
		runWpCliCommand: vi.fn(),
	};
} );

describe( 'export-database', () => {
	const site = { id: 'site-1', name: 'Test Site', path: '/test/site', port: 8080 } as SiteData;

	const mockWpCliFailure = ( stdout: string, stderr: string ) => {
		vi.mocked( runWpCliCommand ).mockResolvedValue( {
			response: new WpCliResponse(
				Readable.from( [ stdout ] ),
				Readable.from( [ stderr ] ),
				Promise.resolve( 1 )
			),
			[ Symbol.dispose ]: vi.fn(),
		} );
	};

	beforeEach( () => {
		vi.clearAllMocks();
	} );

	// A site that has never been started has no database, so WP-CLI can't boot it. The
	// reason has to reach the user instead of a bare "Database export failed".
	it( 'surfaces the WP-CLI error when exporting a site that was never started', async () => {
		mockWpCliFailure( '', 'Error: The site you have requested is not installed.' );

		await expect( exportDatabaseToFile( site, '/tmp/out.sql' ) ).rejects.toThrow(
			'Database export failed: Error: The site you have requested is not installed.'
		);
	} );

	// Which stream carries the message depends on the runtime, so both are reported.
	it( 'surfaces WP-CLI output sent to stdout', async () => {
		mockWpCliFailure( 'Error: could not read the database.', '' );

		await expect( exportDatabaseToMultipleFiles( site, '/tmp/out' ) ).rejects.toThrow(
			'Database export failed: Error: could not read the database.'
		);
	} );
} );
