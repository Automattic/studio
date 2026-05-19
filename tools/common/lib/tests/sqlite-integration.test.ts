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

	describe( 'needsSqliteSetup', () => {
		it( 'should return true when db.php exists', async () => {
			volFromJSON( { [ normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ) ]: '' } );

			const result = await provider.needsSqliteSetup( MOCK_SITE_PATH );

			expect( result ).toBe( true );
		} );

		it( 'should return true when wp-config.php does not exist', async () => {
			const result = await provider.needsSqliteSetup( MOCK_SITE_PATH );

			expect( result ).toBe( true );
		} );

		it( 'should return false when wp-config.php exists and db.php does not', async () => {
			volFromJSON( { [ normalize( `${ MOCK_SITE_PATH }/wp-config.php` ) ]: 'config' } );

			const result = await provider.needsSqliteSetup( MOCK_SITE_PATH );

			expect( result ).toBe( false );
		} );

		it( 'should return true when both files exist (db.php takes precedence)', async () => {
			volFromJSON( {
				[ normalize( `${ MOCK_SITE_PATH }/wp-config.php` ) ]: 'config',
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ) ]: 'db-content',
			} );

			const result = await provider.needsSqliteSetup( MOCK_SITE_PATH );

			expect( result ).toBe( true );
		} );
	} );

	describe( 'shouldKeepExistingDbDropin', () => {
		it( 'should return false when db.php does not exist', async () => {
			const result = await provider.shouldKeepExistingDbDropin( MOCK_SITE_PATH );
			expect( result ).toBe( false );
		} );

		it( 'should return false when db.php does not include the Studio keep marker', async () => {
			volFromJSON( {
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ) ]:
					"<?php\ndefine( 'SQLITE_DB_DROPIN_VERSION', '1.8.0' );\ndefine( 'MARKDOWN_DB_DROPIN', true );",
			} );

			const result = await provider.shouldKeepExistingDbDropin( MOCK_SITE_PATH );
			expect( result ).toBe( false );
		} );

		it( 'should return true when db.php includes the Studio keep marker', async () => {
			volFromJSON( {
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ) ]:
					"<?php\n// @studio-keep\ndefine( 'SQLITE_DB_DROPIN_VERSION', '1.8.0' );\ndefine( 'MARKDOWN_DB_DROPIN', true );",
			} );

			const result = await provider.shouldKeepExistingDbDropin( MOCK_SITE_PATH );
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

		it( 'should not overwrite db.php drop-in with the Studio keep marker', async () => {
			volFromJSON( {
				[ normalize( `wp-files/${ SQLITE_DIRNAME }/db.copy` ) ]:
					"SQLIntegration path: '{SQLITE_IMPLEMENTATION_FOLDER_PATH}'",
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ) ]:
					"<?php\n// @studio-keep\ndefine( 'SQLITE_DB_DROPIN_VERSION', '1.8.0' );\ndefine( 'MARKDOWN_DB_DROPIN', true );",
			} );

			await provider.installSqliteIntegration( MOCK_SITE_PATH );

			expect( vi.mocked( fs.promises.writeFile ) ).not.toHaveBeenCalledWith(
				normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ),
				expect.any( String )
			);
		} );

		it( 'should still copy mu-plugin when db.php has the Studio keep marker', async () => {
			volFromJSON( {
				[ normalize( `wp-files/${ SQLITE_DIRNAME }/db.copy` ) ]:
					"SQLIntegration path: '{SQLITE_IMPLEMENTATION_FOLDER_PATH}'",
				[ normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ) ]:
					"<?php\n// @studio-keep\ndefine( 'SQLITE_DB_DROPIN_VERSION', '1.8.0' );\ndefine( 'MARKDOWN_DB_DROPIN', true );",
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

		it( 'should throw error when SQLite files not available', async () => {
			provider.isSqliteIntegrationAvailable = vi.fn().mockResolvedValue( false );

			await expect( provider.installSqliteIntegration( MOCK_SITE_PATH ) ).rejects.toThrow(
				'SQLite integration files not found'
			);
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

		it( 'should not install when wp-config.php exists and db.php does not', async () => {
			volFromJSON( { [ normalize( `${ MOCK_SITE_PATH }/wp-config.php` ) ]: 'config' } );

			await provider.keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

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
