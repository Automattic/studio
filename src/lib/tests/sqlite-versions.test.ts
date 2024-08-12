import fs from 'fs-extra';
import { SQLITE_FILENAME } from '../../../vendor/wp-now/src/constants';
import { installSqliteIntegration, keepSqliteIntegrationUpdated } from '../sqlite-versions';

jest.mock( 'fs-extra' );
jest.mock( '../../../vendor/wp-now/src/download' );
jest.mock( '../../../vendor/wp-now/src/get-sqlite-path', () =>
	jest.fn().mockReturnValue( `server-files/${ SQLITE_FILENAME }` )
);
jest.mock( '../../storage/paths', () => ( {
	getServerFilesPath: jest.fn().mockReturnValue( 'server-files' ),
} ) );

const MOCK_SITE_PATH = 'mock-site-path';

afterEach( () => {
	jest.clearAllMocks();
	( fs as MockedFsExtra ).__mockFiles = {};
} );

describe( 'keepSqliteIntegrationUpdated', () => {
	describe( 'when SQLite integration is installed in a site', () => {
		it( 'should update SQLite integration when outdated', async () => {
			( fs as MockedFsExtra ).__setFileContents( `${ MOCK_SITE_PATH }/wp-config.php`, '' );

			// Mock SQLite integration version of server files
			( fs as MockedFsExtra ).__setFileContents(
				`server-files/${ SQLITE_FILENAME }/load.php`,
				' * Version: 2.1.13'
			);

			// Mock SQLite integration version of mocked site
			( fs as MockedFsExtra ).__setFileContents(
				`${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }`,
				[ 'load.php' ]
			);
			( fs as MockedFsExtra ).__setFileContents(
				`${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }/load.php`,
				' * Version: 2.1.11'
			);

			await keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( fs.copy ).toHaveBeenCalledWith(
				'server-files/sqlite-database-integration',
				`${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }`
			);
		} );
		it( 'should not update SQLite integration when is up-to-date', async () => {
			// Mock SQLite integration version of server files
			( fs as MockedFsExtra ).__setFileContents(
				`server-files/${ SQLITE_FILENAME }/load.php`,
				' * Version: 2.1.13'
			);

			// Mock SQLite integration version of mocked site
			( fs as MockedFsExtra ).__setFileContents(
				`${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }`,
				[ 'load.php' ]
			);
			( fs as MockedFsExtra ).__setFileContents(
				`${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }/load.php`,
				' * Version: 2.1.13'
			);

			await keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( fs.copy ).not.toHaveBeenCalledWith(
				`server-files/${ SQLITE_FILENAME }`,
				`${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }`
			);
		} );
	} );

	describe( 'when SQLite integration is not installed in a site', () => {
		it( 'should install it if wp-config.php is not defined', async () => {
			// Mock SQLite integration version of server files
			( fs as MockedFsExtra ).__setFileContents(
				`server-files/${ SQLITE_FILENAME }/load.php`,
				' * Version: 2.1.13'
			);

			await keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( fs.copy ).toHaveBeenCalledWith(
				`server-files/${ SQLITE_FILENAME }`,
				`${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }`
			);
		} );
		it( 'should not install it if wp-config.php is defined', async () => {
			// Mock site wp-config-php
			( fs as MockedFsExtra ).__setFileContents(
				`${ MOCK_SITE_PATH }/wp-config.php`,
				'config-sample'
			);
			// Mock SQLite integration version of server files
			( fs as MockedFsExtra ).__setFileContents(
				`server-files/${ SQLITE_FILENAME }/load.php`,
				' * Version: 2.1.13'
			);
			await keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( fs.copy ).not.toHaveBeenCalledWith(
				`server-files/${ SQLITE_FILENAME }`,
				`${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }`
			);
		} );
	} );
} );

describe( 'installSqliteIntegration', () => {
	it( 'should install SQLite integration', async () => {
		// Mock site default db.php
		( fs as MockedFsExtra ).__setFileContents(
			`${ MOCK_SITE_PATH }/wp-content/db.php`,
			"SQLIntegration path: '{SQLITE_IMPLEMENTATION_FOLDER_PATH}'"
		);

		await installSqliteIntegration( MOCK_SITE_PATH );

		expect( fs.mkdir ).toHaveBeenCalledWith( `${ MOCK_SITE_PATH }/wp-content/database`, {
			recursive: true,
		} );
		expect( fs.copyFile ).toHaveBeenCalledWith(
			`server-files/${ SQLITE_FILENAME }/db.copy`,
			`${ MOCK_SITE_PATH }/wp-content/db.php`
		);
		expect( fs.writeFile ).toHaveBeenCalledWith(
			`${ MOCK_SITE_PATH }/wp-content/db.php`,
			`SQLIntegration path: realpath( __DIR__ . '/mu-plugins/${ SQLITE_FILENAME }' )`
		);
		expect( fs.copy ).toHaveBeenCalledWith(
			`server-files/${ SQLITE_FILENAME }`,
			`${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }`
		);
	} );
} );
