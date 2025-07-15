import fs from 'fs-extra';
import { SQLITE_DATABASE_INTEGRATION_VERSION } from 'src/constants';
import { installSqliteIntegration, keepSqliteIntegrationUpdated } from 'src/lib/sqlite-versions';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';

const SQLITE_FILENAME = 'sqlite-database-integration';

jest.mock( 'fs-extra' );
jest.mock( 'src/lib/wordpress-provider', () => ( {
	SQLITE_FILENAME: 'sqlite-database-integration',
} ) );
jest.mock( 'vendor/wp-now/src/get-sqlite-path', () => {
	return jest.fn().mockReturnValue( 'server-files/sqlite-database-integration' );
} );
jest.mock( 'src/storage/paths', () => ( {
	getServerFilesPath: jest.fn().mockReturnValue( 'server-files' ),
} ) );

const MOCK_SITE_PATH = 'mock-site-path';

afterEach( () => {
	jest.clearAllMocks();
	( fs as MockedFsExtra ).__mockFiles = {};
} );

platformTestSuite( 'keepSqliteIntegrationUpdated', ( { normalize } ) => {
	describe( 'when SQLite integration is installed in a site', () => {
		it( 'should update SQLite integration when outdated', async () => {
			( fs as MockedFsExtra ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-config.php` ),
				''
			);

			// Mock SQLite integration version of server files
			( fs as MockedFsExtra ).__setFileContents(
				normalize( `server-files/${ SQLITE_FILENAME }/load.php` ),
				' * Version: 2.1.13'
			);

			// Mock SQLite integration version of mocked site
			( fs as MockedFsExtra ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }` ),
				[ 'load.php' ]
			);
			( fs as MockedFsExtra ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }/load.php` ),
				' * Version: 2.1.11'
			);

			await keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( fs.copy ).toHaveBeenCalledWith(
				normalize( 'server-files/sqlite-database-integration' ),
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }` )
			);
		} );
		it( 'should not update SQLite integration when is up-to-date', async () => {
			// Mock SQLite integration version of server files
			( fs as MockedFsExtra ).__setFileContents(
				normalize( `server-files/${ SQLITE_FILENAME }/load.php` ),
				` * Version: ${ SQLITE_DATABASE_INTEGRATION_VERSION }`
			);

			// Mock SQLite integration version of mocked site
			( fs as MockedFsExtra ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }` ),
				[ 'load.php' ]
			);
			( fs as MockedFsExtra ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }/load.php` ),
				` * Version: ${ SQLITE_DATABASE_INTEGRATION_VERSION }`
			);

			await keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( fs.copy ).not.toHaveBeenCalledWith(
				normalize( `server-files/${ SQLITE_FILENAME }` ),
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }` )
			);
		} );
	} );

	describe( 'when SQLite integration is not installed in a site', () => {
		it( 'should install it if wp-config.php is not defined', async () => {
			// Mock SQLite integration version of server files
			( fs as MockedFsExtra ).__setFileContents(
				normalize( `server-files/${ SQLITE_FILENAME }/load.php` ),
				' * Version: 2.1.13'
			);

			await keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( fs.copy ).toHaveBeenCalledWith(
				normalize( `server-files/${ SQLITE_FILENAME }` ),
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }` )
			);
		} );
		it( 'should not install it if wp-config.php is defined', async () => {
			// Mock site wp-config-php
			( fs as MockedFsExtra ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-config.php` ),
				'config-sample'
			);
			// Mock SQLite integration version of server files
			( fs as MockedFsExtra ).__setFileContents(
				normalize( `server-files/${ SQLITE_FILENAME }/load.php` ),
				' * Version: 2.1.13'
			);
			await keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( fs.copy ).not.toHaveBeenCalledWith(
				normalize( `server-files/${ SQLITE_FILENAME }` ),
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }` )
			);
		} );
	} );
} );

platformTestSuite( 'installSqliteIntegration', ( { normalize } ) => {
	it( 'should install SQLite integration', async () => {
		// Mock site default db.php
		( fs as MockedFsExtra ).__setFileContents(
			normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ),
			"SQLIntegration path: '{SQLITE_IMPLEMENTATION_FOLDER_PATH}'"
		);

		await installSqliteIntegration( MOCK_SITE_PATH );

		expect( fs.mkdir ).toHaveBeenCalledWith(
			normalize( `${ MOCK_SITE_PATH }/wp-content/database` ),
			{ recursive: true }
		);
		expect( fs.copyFile ).toHaveBeenCalledWith(
			normalize( `server-files/${ SQLITE_FILENAME }/db.copy` ),
			normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` )
		);
		expect( fs.writeFile ).toHaveBeenCalledWith(
			normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ),
			`SQLIntegration path: realpath( __DIR__ . '/mu-plugins/${ SQLITE_FILENAME }' )`
		);
		expect( fs.copy ).toHaveBeenCalledWith(
			normalize( `server-files/${ SQLITE_FILENAME }` ),
			normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }` )
		);
	} );
} );
