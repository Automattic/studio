import fs from 'fs-extra';
import { SQLITE_FILENAME } from '../../constants';
import { setupSqliteDatabase } from '../sqlite-setup';

jest.mock( 'fs-extra' );

const MOCK_SITE_PATH = '/mock-site-path';
const MOCK_SERVER_FILES_PATH = '/mock-server-files';

type MockedFsExtra = jest.Mocked< typeof fs >;

describe( 'setupSqliteDatabase', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'should set up SQLite database integration', async () => {
		( fs as MockedFsExtra ).readFile.mockResolvedValue(
			// @ts-expect-error -- MOCKED buffer value --
			"SQLIntegration path: '{SQLITE_IMPLEMENTATION_FOLDER_PATH}'"
		);

		await setupSqliteDatabase( MOCK_SITE_PATH, MOCK_SERVER_FILES_PATH );

		// Should create database directory
		expect( fs.mkdir ).toHaveBeenCalledWith( `${ MOCK_SITE_PATH }/wp-content/database`, {
			recursive: true,
		} );

		// Should copy db.copy to db.php
		expect( fs.copyFile ).toHaveBeenCalledWith(
			`${ MOCK_SERVER_FILES_PATH }/${ SQLITE_FILENAME }/db.copy`,
			`${ MOCK_SITE_PATH }/wp-content/db.php`
		);

		// Should update db.php with correct path
		expect( fs.writeFile ).toHaveBeenCalledWith(
			`${ MOCK_SITE_PATH }/wp-content/db.php`,
			`SQLIntegration path: realpath( __DIR__ . '/mu-plugins/${ SQLITE_FILENAME }' )`
		);

		// Should copy SQLite plugin files
		expect( fs.copy ).toHaveBeenCalledWith(
			`${ MOCK_SERVER_FILES_PATH }/${ SQLITE_FILENAME }`,
			`${ MOCK_SITE_PATH }/wp-content/mu-plugins/${ SQLITE_FILENAME }`
		);
	} );

	it( 'should handle errors gracefully', async () => {
		const mockError = new Error( 'File system error' );
		( fs as MockedFsExtra ).mkdir.mockRejectedValue( mockError );

		await expect( setupSqliteDatabase( MOCK_SITE_PATH, MOCK_SERVER_FILES_PATH ) ).rejects.toThrow(
			'File system error'
		);
	} );
} );
