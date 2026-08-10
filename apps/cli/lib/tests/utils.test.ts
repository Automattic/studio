import os from 'node:os';
import {
	classifyExportFailure,
	classifyImportFailure,
	getPrettyPath,
	normalizeHostname,
} from 'cli/lib/utils';
import { LoggerError } from 'cli/logger';

// The failure classifiers translate their known msgids at match time so they work against
// localized error messages. This map lets individual tests install fake "translations".
const translations: Record< string, string > = {};
vi.mock( '@wordpress/i18n', async ( importActual ) => {
	const actual = await importActual< typeof import('@wordpress/i18n') >();
	return {
		...actual,
		__: ( text: string ) => translations[ text ] ?? text,
	};
} );

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
		[ 'WordPress export import failed: wp-cli stderr output', 'wxr_import' ],
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

	it( 'classifies localized error messages', () => {
		translations[ 'Database import failed: %s' ] = 'Datenbankimport fehlgeschlagen: %s';
		translations[ 'No suitable importer found for the provided backup contents' ] =
			'Kein passender Importer für die bereitgestellten Backup-Inhalte gefunden';
		try {
			expect(
				classifyImportFailure( new Error( 'Datenbankimport fehlgeschlagen: FEHLER 123' ) )
			).toBe( 'database_import' );
			expect(
				classifyImportFailure(
					new Error( 'Kein passender Importer für die bereitgestellten Backup-Inhalte gefunden' )
				)
			).toBe( 'no_importer_found' );
			// The English text no longer matches once a translation is active — same as at the
			// throw site, which produces the translated message.
			expect( classifyImportFailure( new Error( 'Database import failed: x' ) ) ).toBe( 'unknown' );
		} finally {
			delete translations[ 'Database import failed: %s' ];
			delete translations[ 'No suitable importer found for the provided backup contents' ];
		}
	} );

	it( 'handles non-Error input', () => {
		expect(
			classifyImportFailure( 'No suitable importer found for the provided backup contents' )
		).toBe( 'no_importer_found' );
		expect( classifyImportFailure( undefined ) ).toBe( 'unknown' );
	} );
} );

describe( 'classifyExportFailure', () => {
	it.each( [
		[ 'No suitable exporter found for the provided backup file', 'no_exporter_found' ],
		[ 'Database export failed', 'database_export' ],
		[ 'Database export failed for table wp_posts', 'database_export' ],
		[ 'Could not get list of database tables to export.', 'database_export' ],
		[ 'Failed to get site plugins: wp-cli stderr output', 'site_meta' ],
		[ 'Failed to get site themes: wp-cli stderr output', 'site_meta' ],
		[
			'Could not parse information about installed plugins to create meta.json file.',
			'site_meta',
		],
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
