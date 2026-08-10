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
		[ 'bundled_wp_missing' ],
		[ 'file_not_found' ],
		[ 'no_backup_handler' ],
		[ 'no_importer_found' ],
		[ 'validation' ],
		[ 'extract' ],
		[ 'database_import' ],
		[ 'wxr_import' ],
	] )( 'returns the %s code carried by a LoggerError', ( code ) => {
		expect( classifyImportFailure( new LoggerError( 'display text', undefined, code ) ) ).toBe(
			code
		);
	} );

	it( 'is locale-independent — classifies by code, not by the translated message', () => {
		const error = new LoggerError(
			'Datenbankimport fehlgeschlagen: FEHLER 123',
			undefined,
			'database_import'
		);
		expect( classifyImportFailure( error ) ).toBe( 'database_import' );
	} );

	it( 'walks the previousError chain for a code', () => {
		const error = new LoggerError(
			'Failed to import site',
			new LoggerError( 'Database import failed: x', undefined, 'database_import' )
		);
		expect( classifyImportFailure( error ) ).toBe( 'database_import' );
	} );

	it.each( [
		[ 'ENOSPC: no space left on device', 'disk_full' ],
		[ 'Error: absolute path: /wp-content/index.php', 'invalid_zip' ],
	] )( 'classifies untranslated system error %j as %s', ( message, expected ) => {
		expect( classifyImportFailure( new Error( message ) ) ).toBe( expected );
	} );

	it( 'prefers disk_full over a coded wrapper when the chain contains ENOSPC', () => {
		const error = new LoggerError(
			'Failed to extract backup',
			new Error( 'ENOSPC: no space left on device' ),
			'extract'
		);
		expect( classifyImportFailure( error ) ).toBe( 'disk_full' );
	} );

	it( 'falls back to unknown', () => {
		expect( classifyImportFailure( new Error( 'Something else entirely' ) ) ).toBe( 'unknown' );
		expect( classifyImportFailure( new LoggerError( 'Uncoded logger error' ) ) ).toBe( 'unknown' );
		expect( classifyImportFailure( undefined ) ).toBe( 'unknown' );
	} );
} );

describe( 'classifyExportFailure', () => {
	it.each( [ [ 'no_exporter_found' ], [ 'database_export' ], [ 'site_meta' ] ] )(
		'returns the %s code carried by a LoggerError',
		( code ) => {
			expect( classifyExportFailure( new LoggerError( 'display text', undefined, code ) ) ).toBe(
				code
			);
		}
	);

	it( 'classifies untranslated ENOSPC errors as disk_full, winning over a coded wrapper', () => {
		expect( classifyExportFailure( new Error( 'ENOSPC: no space left on device' ) ) ).toBe(
			'disk_full'
		);
		expect(
			classifyExportFailure(
				new LoggerError(
					'Database export failed',
					new Error( 'ENOSPC: no space left on device' ),
					'database_export'
				)
			)
		).toBe( 'disk_full' );
	} );

	it( 'falls back to unknown', () => {
		expect( classifyExportFailure( new Error( 'Something else entirely' ) ) ).toBe( 'unknown' );
		expect( classifyExportFailure( undefined ) ).toBe( 'unknown' );
	} );

	it( 'walks the previousError chain for a code', () => {
		const error = new LoggerError(
			'Failed to export site',
			new LoggerError( 'Database export failed', undefined, 'database_export' )
		);
		expect( classifyExportFailure( error ) ).toBe( 'database_export' );
	} );
} );
