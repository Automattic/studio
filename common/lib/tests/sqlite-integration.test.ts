import fs from 'fs-extra';
import { SqliteIntegrationProvider } from 'common/lib/sqlite-integration';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';

const SQLITE_DIRNAME = 'sqlite-database-integration';
const MOCK_SITE_PATH = 'mock-site-path';

jest.mock( 'fs-extra' );

class TestSqliteProvider extends SqliteIntegrationProvider {
	getServerFilesPath(): string {
		return 'server-files';
	}

	getSqliteDirname(): string {
		return SQLITE_DIRNAME;
	}
}

platformTestSuite( 'SqliteIntegrationProvider', ( { normalize } ) => {
	let provider: TestSqliteProvider;

	beforeEach( () => {
		provider = new TestSqliteProvider();
		jest.clearAllMocks();
		require( 'fs-extra' ).__mockFiles = {};
	} );

	describe( 'needsSqliteSetup', () => {
		it( 'should return true when db.php exists', async () => {
			require( 'fs-extra' ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ),
				''
			);

			const result = await provider.needsSqliteSetup( MOCK_SITE_PATH );

			expect( result ).toBe( true );
		} );

		it( 'should return true when wp-config.php does not exist', async () => {
			const result = await provider.needsSqliteSetup( MOCK_SITE_PATH );

			expect( result ).toBe( true );
		} );

		it( 'should return false when wp-config.php exists and db.php does not', async () => {
			require( 'fs-extra' ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-config.php` ),
				'config'
			);

			const result = await provider.needsSqliteSetup( MOCK_SITE_PATH );

			expect( result ).toBe( false );
		} );

		it( 'should return true when both files exist (db.php takes precedence)', async () => {
			require( 'fs-extra' ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-config.php` ),
				'config'
			);
			require( 'fs-extra' ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ),
				'db-content'
			);

			const result = await provider.needsSqliteSetup( MOCK_SITE_PATH );

			expect( result ).toBe( true );
		} );
	} );

	describe( 'installSqliteIntegration', () => {
		beforeEach( () => {
			require( 'fs-extra' ).__setFileContents(
				normalize( 'server-files/sqlite-database-integration/db.copy' ),
				"SQLIntegration path: '{SQLITE_IMPLEMENTATION_FOLDER_PATH}'"
			);
			require( 'fs-extra' ).__setFileContents(
				normalize( 'server-files/sqlite-database-integration' ),
				'dir'
			);
		} );

		it( 'should create database directory', async () => {
			await provider.installSqliteIntegration( MOCK_SITE_PATH );

			expect( fs.mkdir ).toHaveBeenCalledWith(
				normalize( `${ MOCK_SITE_PATH }/wp-content/database` ),
				{ recursive: true }
			);
		} );

		it( 'should write db.php with correct path', async () => {
			await provider.installSqliteIntegration( MOCK_SITE_PATH );

			expect( fs.writeFile ).toHaveBeenCalledWith(
				normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ),
				`SQLIntegration path: realpath( __DIR__ . '/mu-plugins/${ SQLITE_DIRNAME }' )`
			);
		} );

		it( 'should copy SQLite plugin to mu-plugins', async () => {
			await provider.installSqliteIntegration( MOCK_SITE_PATH );

			expect( fs.copy ).toHaveBeenCalledWith(
				normalize( `server-files/${ SQLITE_DIRNAME }` ),
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_DIRNAME }` )
			);
		} );

		it( 'should throw error when SQLite files not available', async () => {
			provider.isSqliteIntegrationAvailable = jest.fn().mockResolvedValue( false );

			await expect( provider.installSqliteIntegration( MOCK_SITE_PATH ) ).rejects.toThrow(
				'SQLite integration files not found'
			);
		} );
	} );

	describe( 'keepSqliteIntegrationUpdated', () => {
		beforeEach( () => {
			require( 'fs-extra' ).__setFileContents(
				normalize( 'server-files/sqlite-database-integration/db.copy' ),
				"SQLIntegration path: '{SQLITE_IMPLEMENTATION_FOLDER_PATH}'"
			);
			require( 'fs-extra' ).__setFileContents(
				normalize( 'server-files/sqlite-database-integration' ),
				'dir'
			);
		} );

		it( 'should install when db.php exists', async () => {
			require( 'fs-extra' ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ),
				''
			);

			await provider.keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( fs.copy ).toHaveBeenCalledWith(
				normalize( `server-files/${ SQLITE_DIRNAME }` ),
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_DIRNAME }` )
			);
		} );

		it( 'should install when wp-config.php does not exist', async () => {
			await provider.keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( fs.copy ).toHaveBeenCalledWith(
				normalize( `server-files/${ SQLITE_DIRNAME }` ),
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_DIRNAME }` )
			);
		} );

		it( 'should not install when wp-config.php exists and db.php does not', async () => {
			require( 'fs-extra' ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-config.php` ),
				'config'
			);

			await provider.keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( fs.copy ).not.toHaveBeenCalled();
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
			require( 'fs-extra' ).__setFileContents(
				normalize( 'mu-plugins/sqlite/load.php' ),
				loadPhpContent
			);

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
			require( 'fs-extra' ).__setFileContents(
				normalize( 'mu-plugins/sqlite/load.php' ),
				'<?php // No version here'
			);

			const version = await provider.getSqliteVersionFromInstallation(
				normalize( 'mu-plugins/sqlite' )
			);

			expect( version ).toBe( '' );
		} );
	} );

	describe( 'isSqliteIntegrationAvailable', () => {
		it( 'should return true when both plugin and db.copy exist', async () => {
			require( 'fs-extra' ).__setFileContents(
				normalize( 'server-files/sqlite-database-integration' ),
				'dir'
			);
			require( 'fs-extra' ).__setFileContents(
				normalize( 'server-files/sqlite-database-integration/db.copy' ),
				'content'
			);

			const available = await provider.isSqliteIntegrationAvailable();

			expect( available ).toBe( true );
		} );

		it( 'should return false when plugin does not exist', async () => {
			const available = await provider.isSqliteIntegrationAvailable();

			expect( available ).toBe( false );
		} );

		it( 'should return false when db.copy does not exist', async () => {
			require( 'fs-extra' ).__setFileContents(
				normalize( 'server-files/sqlite-database-integration/other-file' ),
				'content'
			);

			const available = await provider.isSqliteIntegrationAvailable();

			expect( available ).toBe( false );
		} );
	} );
} );
