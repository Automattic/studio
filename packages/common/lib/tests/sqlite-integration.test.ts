import fs from 'fs';
import path from 'path';
import { vol } from 'memfs';
import { vi } from 'vitest';
import { SqliteIntegrationProvider } from '../sqlite-integration';
import { platformTestSuite } from './utils/platform-test-suite';

// memfs path resolution uses path.sep. platformTestSuite overrides path.sep to
// '\\' for Windows tests, which breaks vol operations. Restore POSIX sep
// temporarily around every vol call so memfs parses paths correctly.
function volFromJSON( files: Record< string, string > ): void {
	const savedSep = path.sep;
	// @ts-expect-error — Temporarily restore POSIX separator for memfs compatibility
	path.sep = '/';
	try {
		const posixFiles: Record< string, string > = {};
		for ( const [ key, value ] of Object.entries( files ) ) {
			posixFiles[ key.replace( /\\/g, '/' ) ] = value;
		}
		vol.fromJSON( posixFiles );
	} finally {
		// @ts-expect-error — Restore original separator
		path.sep = savedSep;
	}
}

const SQLITE_DIRNAME = 'sqlite-database-integration';
const MOCK_SITE_PATH = 'mock-site-path';

vi.mock( 'fs' );

class TestSqliteProvider extends SqliteIntegrationProvider {
	getSqliteDirname(): string {
		return SQLITE_DIRNAME;
	}

	protected getSqlitePluginSourcePath(): string {
		return path.join( 'wp-files', SQLITE_DIRNAME );
	}
}

platformTestSuite( 'SqliteIntegrationProvider', ( { normalize } ) => {
	let provider: TestSqliteProvider;

	beforeEach( () => {
		provider = new TestSqliteProvider();
		vi.clearAllMocks();
		vol.reset();
	} );

	describe( 'shouldReplaceDbDropin', () => {
		// The stock drop-in carries this auto-generated header (see db.copy). Custom
		// drop-ins define SQLITE_DB_DROPIN_VERSION but lack this comment.
		const STOCK_DB_PHP =
			"<?php\n/**\n * Plugin Name: SQLite integration (Drop-in)\n *\n * This file is auto-generated and copied from the sqlite plugin.\n */\ndefine( 'SQLITE_DB_DROPIN_VERSION', '1.8.0' );";

		it( 'should replace a missing db.php so it gets recreated', async () => {
			const result = await provider.shouldReplaceDbDropin( MOCK_SITE_PATH );
			expect( result ).toBe( true );
		} );

		it( 'should not replace a custom SQLite drop-in even without the keep marker', async () => {
			// Regression: STU-1571 — markdown-database-integration ships its own SQLite
			// drop-in that defines SQLITE_DB_DROPIN_VERSION; Studio must not clobber it.
			volFromJSON( {
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ) ]:
					"<?php\ndefine( 'SQLITE_DB_DROPIN_VERSION', '1.8.0' );\ndefine( 'MARKDOWN_DB_DROPIN', true );",
			} );

			const result = await provider.shouldReplaceDbDropin( MOCK_SITE_PATH );
			expect( result ).toBe( false );
		} );

		it( 'should replace a non-SQLite db.php even if it carries the legacy @studio-keep marker', async () => {
			// The preservation contract is SQLITE_DB_DROPIN_VERSION; the legacy @studio-keep
			// marker no longer forces a non-SQLite drop-in to be kept.
			volFromJSON( {
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ) ]:
					"<?php\n// @studio-keep\nrequire_once 'custom-db.php';",
			} );

			const result = await provider.shouldReplaceDbDropin( MOCK_SITE_PATH );
			expect( result ).toBe( true );
		} );

		it( 'should replace the stock Studio drop-in so it stays current', async () => {
			volFromJSON( {
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ) ]: STOCK_DB_PHP,
			} );

			const result = await provider.shouldReplaceDbDropin( MOCK_SITE_PATH );
			expect( result ).toBe( true );
		} );

		it( 'should replace a foreign db.php that is not a SQLite drop-in', async () => {
			// Regression: STU-1744 — a WordPress.com backup can restore a plugin-owned
			// db.php (e.g. Query Monitor) that the local SQLite runtime cannot use.
			volFromJSON( {
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ) ]:
					"<?php\n// Query Monitor database collector drop-in.\nrequire_once 'qm-db.php';",
			} );

			const result = await provider.shouldReplaceDbDropin( MOCK_SITE_PATH );
			expect( result ).toBe( true );
		} );
	} );

	describe( 'installSqliteIntegration', () => {
		beforeEach( () => {
			volFromJSON( {
				[ normalize( `wp-files/${ SQLITE_DIRNAME }/db.copy` ) ]:
					"SQLIntegration path: '{SQLITE_IMPLEMENTATION_FOLDER_PATH}'",
			} );
		} );

		it( 'should create database directory', async () => {
			await provider.installSqliteIntegration( MOCK_SITE_PATH );

			expect( vi.mocked( fs.promises.mkdir ) ).toHaveBeenCalledWith(
				normalize( `${ MOCK_SITE_PATH }/wp-content/database` ),
				{ recursive: true }
			);
		} );

		it( 'should write db.php with correct path', async () => {
			await provider.installSqliteIntegration( MOCK_SITE_PATH );

			expect( vi.mocked( fs.promises.writeFile ) ).toHaveBeenCalledWith(
				normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ),
				`SQLIntegration path: realpath( __DIR__ . '/mu-plugins/${ SQLITE_DIRNAME }' )`
			);
		} );

		it( 'should still copy the mu-plugin when keeping a custom drop-in', async () => {
			volFromJSON( {
				[ normalize( `wp-files/${ SQLITE_DIRNAME }/db.copy` ) ]:
					"SQLIntegration path: '{SQLITE_IMPLEMENTATION_FOLDER_PATH}'",
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ) ]:
					"<?php\ndefine( 'SQLITE_DB_DROPIN_VERSION', '1.8.0' );\ndefine( 'MARKDOWN_DB_DROPIN', true );",
			} );

			await provider.installSqliteIntegration( MOCK_SITE_PATH );

			expect( vi.mocked( fs.promises.cp ) ).toHaveBeenCalledWith(
				normalize( `wp-files/${ SQLITE_DIRNAME }` ),
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_DIRNAME }` ),
				expect.any( Object )
			);
		} );

		it( 'should copy SQLite plugin to mu-plugins', async () => {
			await provider.installSqliteIntegration( MOCK_SITE_PATH );

			expect( vi.mocked( fs.promises.cp ) ).toHaveBeenCalledWith(
				normalize( `wp-files/${ SQLITE_DIRNAME }` ),
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_DIRNAME }` ),
				expect.any( Object )
			);
		} );

		it( 'should not overwrite a custom SQLite drop-in', async () => {
			volFromJSON( {
				[ normalize( `wp-files/${ SQLITE_DIRNAME }/db.copy` ) ]:
					"SQLIntegration path: '{SQLITE_IMPLEMENTATION_FOLDER_PATH}'",
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ) ]:
					"<?php\ndefine( 'SQLITE_DB_DROPIN_VERSION', '1.8.0' );\ndefine( 'MARKDOWN_DB_DROPIN', true );",
			} );

			await provider.installSqliteIntegration( MOCK_SITE_PATH );

			expect( vi.mocked( fs.promises.writeFile ) ).not.toHaveBeenCalledWith(
				normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ),
				expect.any( String )
			);
		} );

		it( 'should overwrite a foreign db.php that is not a SQLite drop-in', async () => {
			volFromJSON( {
				[ normalize( `wp-files/${ SQLITE_DIRNAME }/db.copy` ) ]:
					"SQLIntegration path: '{SQLITE_IMPLEMENTATION_FOLDER_PATH}'",
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ) ]:
					"<?php\n// Query Monitor database collector drop-in.\nrequire_once 'qm-db.php';",
			} );

			await provider.installSqliteIntegration( MOCK_SITE_PATH );

			expect( vi.mocked( fs.promises.writeFile ) ).toHaveBeenCalledWith(
				normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ),
				`SQLIntegration path: realpath( __DIR__ . '/mu-plugins/${ SQLITE_DIRNAME }' )`
			);
		} );

		it( 'should throw error when SQLite files not available', async () => {
			provider.isSqliteIntegrationAvailable = vi.fn().mockResolvedValue( false );

			await expect( provider.installSqliteIntegration( MOCK_SITE_PATH ) ).rejects.toThrow(
				'SQLite integration files not found'
			);
		} );
	} );

	describe( 'needsSqliteSetup', () => {
		it( 'should return true for a fresh site without wp-config.php', async () => {
			const result = await provider.needsSqliteSetup( MOCK_SITE_PATH );
			expect( result ).toBe( true );
		} );

		it( 'should return true when db.php exists', async () => {
			volFromJSON( {
				[ normalize( `${ MOCK_SITE_PATH }/wp-config.php` ) ]: 'config',
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ) ]: '',
			} );

			const result = await provider.needsSqliteSetup( MOCK_SITE_PATH );
			expect( result ).toBe( true );
		} );

		it( 'should return true when the SQLite database remains but db.php is missing', async () => {
			volFromJSON( {
				[ normalize( `${ MOCK_SITE_PATH }/wp-config.php` ) ]: 'config',
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/database/.ht.sqlite` ) ]: '',
			} );

			const result = await provider.needsSqliteSetup( MOCK_SITE_PATH );
			expect( result ).toBe( true );
		} );

		it( 'should return true when the SQLite mu-plugin remains but db.php is missing', async () => {
			volFromJSON( {
				[ normalize( `${ MOCK_SITE_PATH }/wp-config.php` ) ]: 'config',
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_DIRNAME }/load.php` ) ]:
					'',
			} );

			const result = await provider.needsSqliteSetup( MOCK_SITE_PATH );
			expect( result ).toBe( true );
		} );

		it( 'should return false for a MySQL site (wp-config.php, no SQLite artifacts)', async () => {
			volFromJSON( { [ normalize( `${ MOCK_SITE_PATH }/wp-config.php` ) ]: 'config' } );

			const result = await provider.needsSqliteSetup( MOCK_SITE_PATH );
			expect( result ).toBe( false );
		} );
	} );

	describe( 'keepSqliteIntegrationUpdated', () => {
		beforeEach( () => {
			volFromJSON( {
				[ normalize( `wp-files/${ SQLITE_DIRNAME }/db.copy` ) ]:
					"SQLIntegration path: '{SQLITE_IMPLEMENTATION_FOLDER_PATH}'",
			} );
		} );

		it( 'should install when db.php exists', async () => {
			volFromJSON( { [ normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ) ]: '' } );

			await provider.keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( vi.mocked( fs.promises.cp ) ).toHaveBeenCalledWith(
				normalize( `wp-files/${ SQLITE_DIRNAME }` ),
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_DIRNAME }` ),
				expect.any( Object )
			);
		} );

		it( 'should install when wp-config.php does not exist', async () => {
			await provider.keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( vi.mocked( fs.promises.cp ) ).toHaveBeenCalledWith(
				normalize( `wp-files/${ SQLITE_DIRNAME }` ),
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_DIRNAME }` ),
				expect.any( Object )
			);
		} );

		it( 'should recreate the drop-in when db.php is missing but the SQLite database remains', async () => {
			// Regression: STU-1821 (Problem 1) — a SQLite site whose db.php went missing
			// (its .ht.sqlite database is still there) must have the drop-in restored.
			volFromJSON( {
				[ normalize( `${ MOCK_SITE_PATH }/wp-config.php` ) ]: 'config',
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/database/.ht.sqlite` ) ]: '',
			} );

			await provider.keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( vi.mocked( fs.promises.writeFile ) ).toHaveBeenCalledWith(
				normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ),
				`SQLIntegration path: realpath( __DIR__ . '/mu-plugins/${ SQLITE_DIRNAME }' )`
			);
			expect( vi.mocked( fs.promises.cp ) ).toHaveBeenCalledWith(
				normalize( `wp-files/${ SQLITE_DIRNAME }` ),
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_DIRNAME }` ),
				expect.any( Object )
			);
		} );

		it( 'should not install for a MySQL site (wp-config.php, no SQLite artifacts)', async () => {
			// A user can run Studio against their own MySQL server by removing db.php,
			// the database directory, and the SQLite mu-plugin, then pointing wp-config.php
			// at MySQL. Studio must not reinstall the SQLite integration over that.
			volFromJSON( { [ normalize( `${ MOCK_SITE_PATH }/wp-config.php` ) ]: 'config' } );

			await provider.keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( vi.mocked( fs.promises.writeFile ) ).not.toHaveBeenCalled();
			expect( vi.mocked( fs.promises.cp ) ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'getSqliteVersionFromInstallation', () => {
		it( 'should extract version from load.php', async () => {
			const loadPhpContent = `<?php
/*
 * Plugin Name: SQLite Integration
 * Version: 2.1.5
 * Description: SQLite integration
 */`;
			volFromJSON( { [ normalize( 'mu-plugins/sqlite/load.php' ) ]: loadPhpContent } );

			const version = await provider.getSqliteVersionFromInstallation(
				normalize( 'mu-plugins/sqlite' )
			);

			expect( version ).toBe( '2.1.5' );
		} );

		it( 'should return empty string if load.php does not exist', async () => {
			const version = await provider.getSqliteVersionFromInstallation(
				normalize( 'non-existent' )
			);

			expect( version ).toBe( '' );
		} );

		it( 'should return empty string if version cannot be parsed', async () => {
			volFromJSON( {
				[ normalize( 'mu-plugins/sqlite/load.php' ) ]: '<?php // No version here',
			} );

			const version = await provider.getSqliteVersionFromInstallation(
				normalize( 'mu-plugins/sqlite' )
			);

			expect( version ).toBe( '' );
		} );
	} );

	describe( 'isSqliteIntegrationAvailable', () => {
		it( 'should return true when both plugin and db.copy exist', async () => {
			volFromJSON( {
				[ normalize( `wp-files/${ SQLITE_DIRNAME }/db.copy` ) ]: 'content',
			} );

			const available = await provider.isSqliteIntegrationAvailable();

			expect( available ).toBe( true );
		} );

		it( 'should return false when plugin does not exist', async () => {
			const available = await provider.isSqliteIntegrationAvailable();

			expect( available ).toBe( false );
		} );

		it( 'should return false when db.copy does not exist', async () => {
			volFromJSON( {
				[ normalize( `wp-files/${ SQLITE_DIRNAME }/other-file` ) ]: 'content',
			} );

			const available = await provider.isSqliteIntegrationAvailable();

			expect( available ).toBe( false );
		} );
	} );
} );
