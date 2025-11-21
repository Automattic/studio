import fs from 'fs-extra';
import { installSqliteIntegration, keepSqliteIntegrationUpdated } from 'src/lib/sqlite-versions';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';

const SQLITE_FILENAME = 'sqlite-database-integration';

jest.mock( 'fs-extra' );
jest.mock( 'src/lib/wordpress-provider', () => ( {
	getWordPressProvider: jest.fn().mockReturnValue( {
		SQLITE_FILENAME: 'sqlite-database-integration',
	} ),
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
	describe( 'when db.php exists', () => {
		it( 'should install SQLite integration', async () => {
			( fs as MockedFsExtra ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-config.php` ),
				''
			);
			( fs as MockedFsExtra ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ),
				''
			);

			await keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( fs.copy ).toHaveBeenCalledWith(
				normalize( 'server-files/sqlite-database-integration' ),
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }` )
			);
		} );
	} );

	describe( 'when wp-config.php does not exist', () => {
		it( 'should install SQLite integration', async () => {
			await keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( fs.copy ).toHaveBeenCalledWith(
				normalize( `server-files/${ SQLITE_FILENAME }` ),
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }` )
			);
		} );
	} );

	describe( 'when wp-config.php exists and db.php does not exist', () => {
		it( 'should not install SQLite integration', async () => {
			// Mock site wp-config.php
			( fs as MockedFsExtra ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-config.php` ),
				'config-sample'
			);

			await keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( fs.copy ).not.toHaveBeenCalledWith(
				normalize( `server-files/${ SQLITE_FILENAME }` ),
				normalize( `${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }` )
			);
		} );
	} );

	describe( 'when db.php exists and wp-config.php also exists', () => {
		it( 'should install SQLite integration', async () => {
			// Mock site db.php
			( fs as MockedFsExtra ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ),
				'content'
			);
			// Mock wp-config.php to ensure db.php takes precedence
			( fs as MockedFsExtra ).__setFileContents(
				normalize( `${ MOCK_SITE_PATH }/wp-config.php` ),
				'config-sample'
			);

			await keepSqliteIntegrationUpdated( MOCK_SITE_PATH );

			expect( fs.copy ).toHaveBeenCalledWith(
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

	it( 'should execute concurrent calls sequentially', async () => {
		let concurrentCalls = 0;
		let maxConcurrentCalls = 0;

		( fs.copy as jest.Mock ).mockImplementation( async () => {
			concurrentCalls++;
			maxConcurrentCalls = Math.max( maxConcurrentCalls, concurrentCalls );

			await new Promise( ( resolve ) => setTimeout( resolve, 5 ) );

			concurrentCalls--;
		} );

		( fs as MockedFsExtra ).__setFileContents(
			normalize( `${ MOCK_SITE_PATH }/wp-content/db.php` ),
			"SQLIntegration path: '{SQLITE_IMPLEMENTATION_FOLDER_PATH}'"
		);

		await Promise.all( [
			installSqliteIntegration( MOCK_SITE_PATH ),
			installSqliteIntegration( MOCK_SITE_PATH ),
			installSqliteIntegration( MOCK_SITE_PATH ),
		] );

		expect( maxConcurrentCalls ).toBe( 1 );
	} );
} );
