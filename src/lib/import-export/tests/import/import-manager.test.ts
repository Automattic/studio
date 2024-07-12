// To run tests, execute `npm run test -- src/lib/tests/import-export/import/import-manager.test.ts``
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { BackupHandlerFactory } from '../../import/handlers/backup-handler-factory';
import { selectImporter, importBackup } from '../../import/import-manager';
import { Importer } from '../../import/importers/Importer';
import { BackupContents, BackupArchiveInfo } from '../../import/types';
import { Validator } from '../../import/validators/Validator';

jest.mock( '../../import/handlers/backup-handler-factory' );
jest.mock( 'fs/promises' );
jest.mock( 'os' );
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
		const mockFile: BackupArchiveInfo = {
			path: '/path/to/backup.tar.gz',
			type: 'application/gzip',
		};
		const mockSitePath = '/path/to/site';
		const mockExtractDir = '/tmp/studio_backup_123456';

		beforeEach( () => {
			jest.clearAllMocks();
			( os.tmpdir as jest.Mock ).mockReturnValue( '/tmp' );
			( path.join as jest.Mock ).mockImplementation( ( ...args ) => args.join( '/' ) );
			( fsPromises.mkdtemp as jest.Mock ).mockResolvedValue( mockExtractDir );
		} );

		it( 'should successfully import a backup', async () => {
			const mockValidator: Validator = {
				canHandle: jest.fn().mockReturnValue( true ),
				parseBackupContents: jest.fn().mockReturnValue( {} as BackupContents ),
			};
			const mockImporter: Importer = {
				import: jest.fn().mockResolvedValue( {} ),
			};
			const MockImporterClass = jest.fn().mockImplementation( () => mockImporter );

			const mockBackupHandler = {
				listFiles: jest.fn().mockResolvedValue( [ 'file1.txt', 'file2.txt' ] ),
				extractFiles: jest.fn().mockResolvedValue( undefined ),
			};
			( BackupHandlerFactory.create as jest.Mock ).mockReturnValue( mockBackupHandler );

			await importBackup( mockFile, mockSitePath, [ mockValidator ], {
				[ mockValidator.constructor.name ]: MockImporterClass,
			} );

			expect( fsPromises.mkdtemp ).toHaveBeenCalledWith( '/tmp/studio_backup' );
			expect( mockBackupHandler.listFiles ).toHaveBeenCalledWith( mockFile );
			expect( mockBackupHandler.extractFiles ).toHaveBeenCalledWith( mockFile, mockExtractDir );
			expect( mockImporter.import ).toHaveBeenCalledWith( mockSitePath );
			expect( fsPromises.rm ).toHaveBeenCalledWith( mockExtractDir, {
				recursive: true,
			} );
		} );

		it( 'should throw an error if no suitable importer is found', async () => {
			const mockValidator: Validator = {
				canHandle: jest.fn().mockReturnValue( false ),
				parseBackupContents: jest.fn(),
			};

			const mockBackupHandler = {
				listFiles: jest.fn().mockResolvedValue( [ 'file1.txt', 'file2.txt' ] ),
			};
			( BackupHandlerFactory.create as jest.Mock ).mockReturnValue( mockBackupHandler );

			await expect( importBackup( mockFile, mockSitePath, [ mockValidator ], {} ) ).rejects.toThrow(
				'No suitable importer found for the given backup file'
			);

			expect( fsPromises.mkdtemp ).toHaveBeenCalledWith( '/tmp/studio_backup' );
			expect( fsPromises.rm ).toHaveBeenCalledWith( mockExtractDir, {
				recursive: true,
			} );
		} );
	} );
} );
