import path from 'path';
import { move } from 'fs-extra';
import { vi } from 'vitest';
import { runWpCliCommand, WpCliResponse } from 'cli/lib/run-wp-cli-command';
import { LoggerError } from 'cli/logger';
import { exportDatabaseToFile, exportDatabaseToMultipleFiles } from '../export-database';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'fs-extra' );
vi.mock( 'cli/lib/run-wp-cli-command' );

const site = { id: 'site-1', name: 'Test Site', path: '/test/site' } as SiteData;

function mockWpCliResult( { exitCode = 0, stdout = '', stderr = '' } ) {
	const response: Partial< WpCliResponse > = {
		exitCode: Promise.resolve( exitCode ),
		stdoutText: Promise.resolve( stdout ),
		stderrText: Promise.resolve( stderr ),
	};
	vi.mocked( runWpCliCommand ).mockResolvedValueOnce( {
		response: response as WpCliResponse,
		[ Symbol.dispose ]: vi.fn(),
	} );
}

async function captureError( promise: Promise< unknown > ): Promise< LoggerError > {
	const error = await promise.catch( ( e: unknown ) => e );
	expect( error ).toBeInstanceOf( LoggerError );
	return error as LoggerError;
}

describe( 'export-database', () => {
	let consoleErrorSpy: ReturnType< typeof vi.spyOn >;

	beforeEach( () => {
		vi.clearAllMocks();
		consoleErrorSpy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
	} );

	afterEach( () => {
		consoleErrorSpy.mockRestore();
	} );

	describe( 'exportDatabaseToFile', () => {
		it( 'moves the exported file to its destination on success', async () => {
			mockWpCliResult( {} );

			await exportDatabaseToFile( site, '/dest/db.sql' );

			expect( move ).toHaveBeenCalledWith(
				expect.stringContaining( path.join( site.path, 'studio-backup-db-export' ) ),
				'/dest/db.sql'
			);
			expect( consoleErrorSpy ).not.toHaveBeenCalled();
		} );

		it( 'logs and includes the WP-CLI SQLite error when the export fails', async () => {
			mockWpCliResult( { exitCode: 1, stderr: 'Error: no such table: wp_options\n' } );

			const error = await captureError( exportDatabaseToFile( site, '/dest/db.sql' ) );

			expect( error.message ).toBe( 'Database export failed: Error: no such table: wp_options' );
			expect( error.code ).toBe( 'database_export' );
			expect( consoleErrorSpy ).toHaveBeenCalledWith(
				'Database export failed',
				'Error: no such table: wp_options'
			);
			expect( move ).not.toHaveBeenCalled();
		} );

		it( 'keeps the generic message when WP-CLI prints nothing to stderr', async () => {
			mockWpCliResult( { exitCode: 1 } );

			const error = await captureError( exportDatabaseToFile( site, '/dest/db.sql' ) );

			expect( error.message ).toBe( 'Database export failed' );
			expect( consoleErrorSpy ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'exportDatabaseToMultipleFiles', () => {
		it( 'logs and includes the WP-CLI SQLite error when listing tables fails', async () => {
			mockWpCliResult( { exitCode: 1, stderr: 'Error: database disk image is malformed' } );

			const error = await captureError( exportDatabaseToMultipleFiles( site, '/dest' ) );

			expect( error.message ).toBe(
				'Database export failed: Error: database disk image is malformed'
			);
			expect( consoleErrorSpy ).toHaveBeenCalledWith(
				'Database export failed',
				'Error: database disk image is malformed'
			);
		} );

		it( 'logs and includes the WP-CLI SQLite error when a table export fails', async () => {
			mockWpCliResult( { stdout: '["wp_options","wp_posts"]' } );
			mockWpCliResult( {} );
			mockWpCliResult( { exitCode: 1, stderr: 'Error: near "FROM": syntax error' } );

			const error = await captureError( exportDatabaseToMultipleFiles( site, '/dest' ) );

			expect( error.message ).toBe(
				'Database export failed for table wp_posts: Error: near "FROM": syntax error'
			);
			expect( consoleErrorSpy ).toHaveBeenCalledWith(
				'Database export failed for table wp_posts',
				'Error: near "FROM": syntax error'
			);
			expect( move ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'returns the exported table files, skipping user tables', async () => {
			mockWpCliResult( { stdout: '["wp_options","wp_users","wp_usermeta"]' } );
			mockWpCliResult( {} );

			const files = await exportDatabaseToMultipleFiles( site, '/dest' );

			expect( files ).toEqual( [ path.join( '/dest', 'wp_options.sql' ) ] );
			expect( runWpCliCommand ).toHaveBeenCalledTimes( 2 );
		} );
	} );
} );
