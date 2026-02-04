// To run tests, execute `npm run test -- src/lib/tests/import-export/tests/import-manager.test.ts`
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { BackupHandlerFactory } from 'src/lib/import-export/import/handlers/backup-handler-factory';
import { selectImporter, importBackup } from 'src/lib/import-export/import/import-manager';
import { Importer } from 'src/lib/import-export/import/importers/importer';
import { BackupContents, BackupArchiveInfo } from 'src/lib/import-export/import/types';
import { Validator } from 'src/lib/import-export/import/validators/validator';
import type { Stats } from 'fs';

vi.mock( 'src/storage/paths', () => ( {
	getResourcesPath: vi.fn().mockReturnValue( '/path/to/app/appData/App Name' ),
	getUserDataCertificatesPath: vi
		.fn()
		.mockReturnValue( '/path/to/app/appData/App Name/certificates' ),
	getUserDataLockFilePath: vi
		.fn()
		.mockReturnValue( '/path/to/app/appData/App Name/appdata-v1.json.lock' ),
} ) );
vi.mock( 'src/lib/import-export/import/handlers/backup-handler-factory' );
vi.mock( 'fs/promises' );
vi.mock( 'os' );
vi.mock( 'path' );

describe( 'importManager', () => {
	describe( 'selectImporter', () => {
		it( 'should select the correct importer', () => {
			class MockValidator implements Validator {
				canHandle = vi.fn().mockReturnValue( true );
				parseBackupContents = vi.fn().mockReturnValue( {} as BackupContents );
			}
			const mockValidator = new MockValidator();
			const MockImporter = vi.fn();

			const options = [
				{
					validator: mockValidator,
					importer: MockImporter,
				},
			];
			const result = selectImporter(
				[ 'file1.txt', 'file2.txt' ],
				'/tmp/extracted',
				vi.fn(),
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
				canHandle = vi.fn().mockReturnValue( false );
				parseBackupContents = vi.fn();
			}
			const mockValidator = new MockValidator();

			const options = [
				{
					validator: mockValidator,
					importer: vi.fn(),
				},
			];
			const result = selectImporter(
				[ 'file1.txt', 'file2.txt' ],
				'/tmp/extracted',
				vi.fn(),
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
			port: 9999,
			phpVersion: '8.3',
			running: false,
		};

		const mockExtractDir = '/tmp/studio_backup_123456';

		beforeEach( () => {
			vi.clearAllMocks();
			vi.mocked( os.tmpdir ).mockReturnValue( '/tmp' );
			vi.mocked( path.join ).mockImplementation( ( ...args ) => args.join( '/' ) );
			vi.mocked( fsPromises.mkdtemp ).mockResolvedValue( mockExtractDir );
		} );

		it( 'should successfully import a backup', async () => {
			const mockValidator: Validator = {
				canHandle: vi.fn().mockReturnValue( true ),
				parseBackupContents: vi.fn().mockReturnValue( {} as BackupContents ),
			};
			const mockImporter: Importer = {
				import: vi.fn().mockResolvedValue( {} ),
				on: vi.fn(),
				emit: vi.fn(),
			};
			const MockImporterClass = vi.fn().mockImplementation( () => mockImporter );

			const mockBackupHandler = {
				listFiles: vi.fn().mockResolvedValue( [ 'file1.txt', 'file2.txt' ] ),
				extractFiles: vi.fn().mockResolvedValue( undefined ),
			};
			vi.mocked( BackupHandlerFactory.create ).mockReturnValue( mockBackupHandler );

			const options = [
				{
					validator: mockValidator,
					importer: MockImporterClass,
				},
			];
			const result = await importBackup( mockFile, mockSite, vi.fn(), options );

			expect( result ).toBeTruthy();
			expect( fsPromises.mkdtemp ).toHaveBeenCalledWith( '/tmp/studio_backup' );
			expect( mockBackupHandler.listFiles ).toHaveBeenCalledWith( mockFile );
			expect( mockBackupHandler.extractFiles ).toHaveBeenCalledWith( mockFile, mockExtractDir );
			expect( mockImporter.import ).toHaveBeenCalledWith( mockSite.path, mockSite.id );
			expect( fsPromises.rm ).toHaveBeenCalledWith( mockExtractDir, {
				recursive: true,
			} );
		} );

		it( 'should throw error if no suitable importer is found', async () => {
			const mockValidator: Validator = {
				canHandle: vi.fn().mockReturnValue( false ),
				parseBackupContents: vi.fn(),
			};

			const mockBackupHandler = {
				listFiles: vi.fn().mockResolvedValue( [ 'file1.txt', 'file2.txt' ] ),
				extractFiles: vi.fn().mockResolvedValue( undefined ),
			};
			vi.mocked( BackupHandlerFactory.create ).mockReturnValue( mockBackupHandler );

			await expect(
				importBackup( mockFile, mockSite, vi.fn(), [
					{
						validator: mockValidator,
						importer: vi.fn(),
					},
				] )
			).rejects.toThrow( 'No suitable importer found for the provided backup contents' );

			expect( fsPromises.mkdtemp ).toHaveBeenCalled();
			expect( fsPromises.rm ).not.toHaveBeenCalled();
		} );

		it( 'should throw error if no suitable backup handler is found', async () => {
			vi.mocked( BackupHandlerFactory.create ).mockReturnValue( undefined );
			vi.mocked( fsPromises.stat ).mockResolvedValue( { size: 1024 } as Stats );

			await expect( importBackup( mockFile, mockSite, vi.fn(), [] ) ).rejects.toThrow(
				'No suitable backup handler found for the provided backup file'
			);

			expect( fsPromises.mkdtemp ).not.toHaveBeenCalled();
			expect( fsPromises.rm ).not.toHaveBeenCalled();
		} );
	} );
} );
