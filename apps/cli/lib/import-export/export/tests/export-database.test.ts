import fs from 'fs';
import os from 'os';
import path from 'path';
import { move } from 'fs-extra';
import { vi } from 'vitest';
import { runWpCliCommand, WpCliResponse } from 'cli/lib/run-wp-cli-command';
import { LoggerError } from 'cli/logger';
import { exportDatabaseToFile, exportDatabaseToMultipleFiles } from '../export-database';
import type { ConfigSite } from '@studio/common/lib/config/schema';

vi.mock( 'fs-extra' );
vi.mock( 'cli/lib/run-wp-cli-command' );

const site = { id: 'site-1', name: 'Test Site', path: '/test/site' } as ConfigSite;

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
		it( 'removes a partial SQL dump when the export process fails', async () => {
			const sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-db-export-test-' ) );
			const testSite = { ...site, path: sitePath };
			vi.mocked( runWpCliCommand ).mockImplementationOnce( async ( _site, args ) => {
				fs.writeFileSync( path.join( sitePath, String( args[ 2 ] ) ), 'partial SQL' );
				return {
					response: {
						exitCode: Promise.resolve( 1 ),
						stderrText: Promise.resolve( 'Error: interrupted' ),
					} as WpCliResponse,
					[ Symbol.dispose ]: vi.fn(),
				};
			} );

			try {
				await expect( exportDatabaseToFile( testSite, '/dest/db.sql' ) ).rejects.toThrow(
					'Database export failed'
				);
				expect( fs.readdirSync( sitePath ) ).toEqual( [] );
			} finally {
				fs.rmSync( sitePath, { recursive: true, force: true } );
			}
		} );

		it( 'moves the exported file to its destination on success', async () => {
			mockWpCliResult( {} );

			await exportDatabaseToFile( site, '/dest/db.sql' );

			expect( move ).toHaveBeenCalledOnce();
			const [ source, destination ] = vi.mocked( move ).mock.calls[ 0 ];
			expect( path.dirname( String( source ) ) ).toBe( path.normalize( site.path ) );
			expect( path.extname( String( source ) ) ).toBe( '.sql' );
			expect( destination ).toBe( '/dest/db.sql' );
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

		it( 'logs the full stderr but keeps only the error line in the message', async () => {
			const stderr = 'Deprecated: noise in /wp-cli/a.php\nError: no such table: wp_options';
			mockWpCliResult( { exitCode: 1, stderr } );

			const error = await captureError( exportDatabaseToFile( site, '/dest/db.sql' ) );

			expect( error.message ).toBe( 'Database export failed: Error: no such table: wp_options' );
			expect( consoleErrorSpy ).toHaveBeenCalledWith( 'Database export failed', stderr );
		} );

		it( 'keeps the generic message when WP-CLI prints nothing to stderr', async () => {
			mockWpCliResult( { exitCode: 1 } );

			const error = await captureError( exportDatabaseToFile( site, '/dest/db.sql' ) );

			expect( error.message ).toBe( 'Database export failed' );
			expect( consoleErrorSpy ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'exportDatabaseToMultipleFiles', () => {
		it( 'preserves a site file named after an exported table', async () => {
			const sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-db-export-test-' ) );
			const testSite = { ...site, path: sitePath };
			const existing = path.join( sitePath, 'wp_options.sql' );
			fs.writeFileSync( existing, 'existing site file' );
			mockWpCliResult( { stdout: '["wp_options"]' } );
			mockWpCliResult( { stdout: 'wp_\n' } );
			vi.mocked( runWpCliCommand ).mockImplementationOnce( async ( _site, args ) => {
				fs.writeFileSync( path.join( sitePath, String( args[ 2 ] ) ), 'new SQL dump' );
				return {
					response: { exitCode: Promise.resolve( 0 ) } as WpCliResponse,
					[ Symbol.dispose ]: vi.fn(),
				};
			} );

			try {
				await exportDatabaseToMultipleFiles( testSite, '/dest' );
				expect( fs.readFileSync( existing, 'utf8' ) ).toBe( 'existing site file' );
			} finally {
				fs.rmSync( sitePath, { recursive: true, force: true } );
			}
		} );

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
			mockWpCliResult( { stdout: 'wp_\n' } );
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
			mockWpCliResult( { stdout: 'wp_\n' } );
			mockWpCliResult( {} );

			const files = await exportDatabaseToMultipleFiles( site, '/dest' );

			expect( files ).toEqual( [ path.join( '/dest', 'wp_options.sql' ) ] );
			expect( runWpCliCommand ).toHaveBeenCalledTimes( 3 );
		} );

		it( "skips the user tables under the site's table prefix", async () => {
			mockWpCliResult( { stdout: '["ntmozf_options","ntmozf_users","ntmozf_usermeta"]' } );
			mockWpCliResult( { stdout: 'ntmozf_\n' } );
			mockWpCliResult( {} );

			const files = await exportDatabaseToMultipleFiles( site, '/dest' );

			expect( files ).toEqual( [ path.join( '/dest', 'ntmozf_options.sql' ) ] );
		} );

		it( 'fails when the table prefix cannot be read', async () => {
			mockWpCliResult( { stdout: '["wp_options","wp_users"]' } );
			mockWpCliResult( {
				exitCode: 1,
				stderr:
					"Error: The constant or variable 'table_prefix' is not defined in the 'wp-config.php' file.",
			} );

			const error = await captureError( exportDatabaseToMultipleFiles( site, '/dest' ) );

			expect( error.message ).toBe(
				"Could not read the table prefix from wp-config.php: Error: The constant or variable 'table_prefix' is not defined in the 'wp-config.php' file."
			);
			expect( move ).not.toHaveBeenCalled();
		} );
	} );
} );
