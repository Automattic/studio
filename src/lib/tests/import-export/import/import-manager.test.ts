// To run tests, execute `npm run test -- src/lib/tests/import-export/import/import-manager.test.ts``
import path from 'path';
import { BackupHandler } from '../../../import-export/import/handlers/backup-handler';
import { selectImporter, importBackup } from '../../../import-export/import/import-manager';
import { Importer } from '../../../import-export/import/importers/Importer';
import { BackupContents, BackupArchiveInfo, DbConfig } from '../../../import-export/import/types';
import { Validator } from '../../../import-export/import/validators/Validator';

jest.mock( '../../../import-export/import/handlers/backup-handler' );
jest.mock( 'path' );

describe( 'importManager', () => {
	describe( 'selectImporter', () => {
		it( 'should select the correct importer', () => {
			class MockValidator implements Validator {
				canHandle = jest.fn().mockReturnValue( true );
				parseBackupContents = jest.fn().mockReturnValue( {} as BackupContents );
			}
			const mockValidator = new MockValidator();
			const MockImporter = jest.fn();
			const importers = {
				MockValidator: MockImporter,
			};

			const result = selectImporter(
				[ 'file1.txt', 'file2.txt' ],
				'/tmp/extracted',
				[ mockValidator ],
				importers
			);

			expect( result ).toBeInstanceOf( MockImporter );
			expect( mockValidator.canHandle ).toHaveBeenCalledWith( [ 'file1.txt', 'file2.txt' ] );
			expect( mockValidator.parseBackupContents ).toHaveBeenCalledWith(
				[ 'file1.txt', 'file2.txt' ],
				'/tmp/extracted'
			);
		} );

		it( 'should return null if no suitable importer is found', () => {
			class MockValidator implements Validator {
				canHandle = jest.fn().mockReturnValue( false );
				parseBackupContents = jest.fn();
			}
			const mockValidator = new MockValidator();

			const result = selectImporter(
				[ 'file1.txt', 'file2.txt' ],
				'/tmp/extracted',
				[ mockValidator ],
				{}
			);

			expect( result ).toBeNull();
		} );
	} );

	describe( 'importBackup', () => {
		it( 'should successfully import a backup', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.tar.gz',
				type: 'application/gzip',
			};
			const rootPath = '/path/to/studio/site';
			const dbConfig: DbConfig = {
				host: 'localhost',
				user: 'user',
				password: 'password',
				database: 'wordpress',
			};

			class MockValidator implements Validator {
				canHandle = jest.fn().mockReturnValue( true );
				parseBackupContents = jest.fn().mockReturnValue( {} as BackupContents );
			}
			const mockValidator = new MockValidator();

			const mockImporter: Importer = {
				import: jest.fn().mockResolvedValue( undefined ),
			};
			const MockImporterClass = jest.fn().mockImplementation( () => mockImporter );

			const mockBackupHandler = {
				listFiles: jest.fn().mockResolvedValue( [ 'file1.txt', 'file2.txt' ] ),
				extractFiles: jest.fn().mockResolvedValue( undefined ),
			};
			( BackupHandler as jest.Mock ).mockImplementation( () => mockBackupHandler );

			( path.dirname as jest.Mock ).mockReturnValue( '/path/to' );
			( path.join as jest.Mock ).mockReturnValue( '/path/to/extracted' );

			await importBackup( archiveInfo, rootPath, dbConfig, [ mockValidator ], {
				MockValidator: MockImporterClass,
			} );

			expect( mockBackupHandler.listFiles ).toHaveBeenCalledWith( archiveInfo );
			expect( mockBackupHandler.extractFiles ).toHaveBeenCalledWith(
				archiveInfo,
				'/path/to/extracted'
			);
			expect( mockImporter.import ).toHaveBeenCalledWith( rootPath, dbConfig );
		} );

		it( 'should throw an error if no suitable importer is found', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.tar.gz',
				type: 'application/gzip',
			};
			const rootPath = '/path/to/studio/site';
			const dbConfig: DbConfig = {
				host: 'localhost',
				user: 'user',
				password: 'password',
				database: 'wordpress',
			};

			class MockValidator implements Validator {
				canHandle = jest.fn().mockReturnValue( false );
				parseBackupContents = jest.fn();
			}
			const mockValidator = new MockValidator();

			const mockBackupHandler = {
				listFiles: jest.fn().mockResolvedValue( [ 'file1.txt', 'file2.txt' ] ),
				extractFiles: jest.fn().mockResolvedValue( undefined ),
			};
			( BackupHandler as jest.Mock ).mockImplementation( () => mockBackupHandler );

			( path.dirname as jest.Mock ).mockReturnValue( '/path/to' );
			( path.join as jest.Mock ).mockReturnValue( '/path/to/extracted' );

			await expect(
				importBackup( archiveInfo, rootPath, dbConfig, [ mockValidator ], {} )
			).rejects.toThrow( 'No suitable importer found for the given backup file' );
		} );
	} );
} );
