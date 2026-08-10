import os from 'node:os';
import {
	classifyExportFailure,
	classifyImportFailure,
	getPrettyPath,
	normalizeHostname,
} from 'cli/lib/utils';
import { LoggerError } from 'cli/logger';

describe( 'normalizeHostname', () => {
	it( 'should normalize a basic hostname', () => {
		expect( normalizeHostname( 'example.com' ) ).toBe( 'example.com' );
	} );

	it( 'should remove http protocol', () => {
		expect( normalizeHostname( 'http://example.com' ) ).toBe( 'example.com' );
	} );

	it( 'should remove https protocol', () => {
		expect( normalizeHostname( 'https://example.com' ) ).toBe( 'example.com' );
	} );

	it( 'should remove trailing slash', () => {
		expect( normalizeHostname( 'example.com/' ) ).toBe( 'example.com' );
	} );

	it( 'should convert to lowercase', () => {
		expect( normalizeHostname( 'EXAMPLE.COM' ) ).toBe( 'example.com' );
	} );

	it( 'should trim whitespace', () => {
		expect( normalizeHostname( '  example.com  ' ) ).toBe( 'example.com' );
	} );

	it( 'should handle multiple transformations', () => {
		expect( normalizeHostname( '  HTTPS://EXAMPLE.COM/  ' ) ).toBe( 'example.com' );
	} );
} );

describe( 'getPrettyPath', () => {
	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should replace current working directory with a dot on Posix', () => {
		vi.spyOn( process, 'cwd' ).mockReturnValue( '/Users/george/Studio' );
		vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'darwin' );
		vi.spyOn( os, 'homedir' ).mockReturnValue( '/Users/george' );

		expect( getPrettyPath( '/Users/george/Studio/my-site/index.php' ) ).toBe(
			'./my-site/index.php'
		);
	} );

	it( 'should not replace current working directory with a dot if at root', () => {
		vi.spyOn( process, 'cwd' ).mockReturnValue( '/' );
		vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'darwin' );
		vi.spyOn( os, 'homedir' ).mockReturnValue( '/Users/george' );

		expect( getPrettyPath( '/Users/jenny/Studio/my-site/index.php' ) ).toBe(
			'/Users/jenny/Studio/my-site/index.php'
		);
	} );

	it( 'should replace current working directory with a dot on Windows', () => {
		vi.spyOn( process, 'cwd' ).mockReturnValue( 'C:\\Users\\george\\Studio' );
		vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'win32' );
		vi.spyOn( os, 'homedir' ).mockReturnValue( 'C:\\Users\\george' );

		expect( getPrettyPath( 'C:\\Users\\george\\Studio\\index.php' ) ).toBe( '.\\index.php' );
	} );

	it( 'should replace home directory prefix with tilde on Posix', () => {
		vi.spyOn( process, 'cwd' ).mockReturnValue( '/etc' );
		vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'darwin' );
		vi.spyOn( os, 'homedir' ).mockReturnValue( '/Users/george' );

		expect( getPrettyPath( '/Users/george/Studio/my-site/index.php' ) ).toBe(
			'~/Studio/my-site/index.php'
		);
	} );

	it( 'should not replace home directory prefix with tilde on Windows', () => {
		vi.spyOn( process, 'cwd' ).mockReturnValue( 'C:\\Windows' );
		vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'win32' );
		vi.spyOn( os, 'homedir' ).mockReturnValue( 'C:\\Users\\george' );

		expect( getPrettyPath( 'C:\\Users\\george\\Studio\\index.php' ) ).toBe(
			'C:\\Users\\george\\Studio\\index.php'
		);
	} );
} );

describe( 'classifyImportFailure', () => {
	it.each( [
		[
			'Cannot set up WordPress. Bundled WordPress files not found. Please connect to the internet or reinstall Studio.',
			'bundled_wp_missing',
		],
		[ 'Import file not found: /tmp/backup.zip', 'file_not_found' ],
		[ 'Input file at location "/tmp/backup.wpress" could not be found.', 'file_not_found' ],
		[ 'No suitable backup handler found for the provided backup file', 'no_backup_handler' ],
		[ 'No suitable importer found for the provided backup contents', 'no_importer_found' ],
		[ 'Backup validation failed', 'validation' ],
		[ 'Error: absolute path: /wp-content/index.php', 'invalid_zip' ],
		[ 'Failed to extract backup', 'extract' ],
		[ 'Database import failed: unexpected token', 'database_import' ],
		[ 'WordPress export import failed', 'wxr_import' ],
		[ 'ENOSPC: no space left on device', 'disk_full' ],
		[ 'Database import failed: ENOSPC: no space left on device', 'disk_full' ],
		[ 'Something else entirely', 'unknown' ],
	] )( 'classifies %j as %s', ( message, expected ) => {
		expect( classifyImportFailure( new Error( message ) ) ).toBe( expected );
	} );

	it( 'classifies the inner error of a LoggerError wrapper', () => {
		const error = new LoggerError( 'Import failed', new Error( 'Database import failed: x' ) );
		expect( classifyImportFailure( error ) ).toBe( 'database_import' );
	} );

	it( 'handles non-Error input', () => {
		expect( classifyImportFailure( 'no suitable importer available' ) ).toBe( 'no_importer_found' );
		expect( classifyImportFailure( undefined ) ).toBe( 'unknown' );
	} );
} );

describe( 'classifyExportFailure', () => {
	it.each( [
		[ 'No suitable exporter found for the provided backup file', 'no_exporter_found' ],
		[ 'Database export failed', 'database_export' ],
		[ 'Failed to get database tables to export', 'database_export' ],
		[ 'Failed to get site plugins', 'site_meta' ],
		[ 'Failed to get site themes', 'site_meta' ],
		[ 'Could not write meta.json', 'site_meta' ],
		[ 'ENOSPC: no space left on device', 'disk_full' ],
		[ 'ENOSPC: no space left on device, write meta.json', 'disk_full' ],
		[ 'Something else entirely', 'unknown' ],
	] )( 'classifies %j as %s', ( message, expected ) => {
		expect( classifyExportFailure( new Error( message ) ) ).toBe( expected );
	} );

	it( 'classifies the inner error of a LoggerError wrapper', () => {
		const error = new LoggerError( 'Export failed', new Error( 'Database export failed' ) );
		expect( classifyExportFailure( error ) ).toBe( 'database_export' );
	} );

	it( 'handles non-Error input', () => {
		expect( classifyExportFailure( undefined ) ).toBe( 'unknown' );
	} );
} );
