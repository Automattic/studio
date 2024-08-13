// To run tests, execute `npm run test -- src/lib/tests/import-export/tests/import-manager.test.ts`
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { BackupHandlerFactory } from '../../import/handlers/backup-handler-factory';
import { selectImporter, importBackup } from '../../import/import-manager';
import { Importer } from '../../import/importers/importer';
import { BackupContents, BackupArchiveInfo } from '../../import/types';
import { Validator } from '../../import/validators/validator';

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

			const options = [
				{
					validator: mockValidator,
					importer: MockImporter,
				},
			];
			const result = selectImporter(
				[ 'file1.txt', 'file2.txt' ],
				'/tmp/extracted',
				jest.fn(),
				options
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

			const options = [
				{
					validator: mockValidator,
					importer: jest.fn(),
				},
			];
			const result = selectImporter(
				[ 'file1.txt', 'file2.txt' ],
				'/tmp/extracted',
				jest.fn(),
				options
			);

			expect( result ).toBeNull();
		} );
	} );

	describe( 'importBackup', () => {
		const mockFile: BackupArchiveInfo = {
			path: '/path/to/backup.tar.gz',
			type: 'application/gzip',
		};
		const mockSite: SiteDetails = {
			id: '123',
			name: 'Site Name',
			path: '/path/to/site',
			phpVersion: '7.4',
			running: false,
		};

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
				on: jest.fn(),
				emit: jest.fn(),
			};
			const MockImporterClass = jest.fn().mockImplementation( () => mockImporter );

			const mockBackupHandler = {
				listFiles: jest.fn().mockResolvedValue( [ 'file1.txt', 'file2.txt' ] ),
				extractFiles: jest.fn().mockResolvedValue( undefined ),
			};
			( BackupHandlerFactory.create as jest.Mock ).mockReturnValue( mockBackupHandler );

			const options = [
				{
					validator: mockValidator,
					importer: MockImporterClass,
				},
			];
			const result = await importBackup( mockFile, mockSite, jest.fn(), options );

			expect( result ).toBeTruthy();
			expect( fsPromises.mkdtemp ).toHaveBeenCalledWith( '/tmp/studio_backup' );
			expect( mockBackupHandler.listFiles ).toHaveBeenCalledWith( mockFile );
			expect( mockBackupHandler.extractFiles ).toHaveBeenCalledWith( mockFile, mockExtractDir );
			expect( mockImporter.import ).toHaveBeenCalledWith( mockSite.path, mockSite.id );
			expect( fsPromises.rm ).toHaveBeenCalledWith( mockExtractDir, {
				recursive: true,
			} );
		} );

		it( 'should return false if no suitable importer is found', async () => {
			const mockValidator: Validator = {
				canHandle: jest.fn().mockReturnValue( false ),
				parseBackupContents: jest.fn(),
			};

			const mockBackupHandler = {
				listFiles: jest.fn().mockResolvedValue( [ 'file1.txt', 'file2.txt' ] ),
			};
			( BackupHandlerFactory.create as jest.Mock ).mockReturnValue( mockBackupHandler );

			const result = await importBackup( mockFile, mockSite, jest.fn(), [
				{
					validator: mockValidator,
					importer: jest.fn(),
				},
			] );

			expect( result ).toBeFalsy();
			expect( fsPromises.mkdtemp ).toHaveBeenCalledWith( '/tmp/studio_backup' );
			expect( fsPromises.rm ).toHaveBeenCalledWith( mockExtractDir, {
				recursive: true,
			} );
		} );
	} );
} );
