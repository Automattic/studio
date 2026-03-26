// To run tests, execute `npm run test -- src/lib/tests/import-export/tests/import-manager.test.ts`
import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { BackupHandlerFactory } from 'src/lib/import-export/import/handlers/backup-handler-factory';
import { selectImporter, importBackup } from 'src/lib/import-export/import/import-manager';
import { Importer } from 'src/lib/import-export/import/importers/importer';
import { BackupContents, BackupArchiveInfo } from 'src/lib/import-export/import/types';
import { Validator } from 'src/lib/import-export/import/validators/validator';
import type { Stats } from 'fs';

vi.mock( 'src/lib/import-export/import/handlers/backup-handler-factory' );
vi.mock( 'fs' );
vi.mock( 'os', () => ( {
	default: {
		tmpdir: vi.fn(),
		homedir: vi.fn().mockReturnValue( '/mock/home' ),
	},
} ) );
vi.mock( 'path', () => ( {
	default: {
		join: vi.fn(),
	},
} ) );

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
			vi.mocked( fs.promises.mkdtemp ).mockResolvedValue( mockExtractDir );
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
			class MockImporterClass {
				import = mockImporter.import;
				on = mockImporter.on;
				emit = mockImporter.emit;
			}

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
			expect( fs.promises.mkdtemp ).toHaveBeenCalledWith( '/tmp/studio_backup' );
			expect( mockBackupHandler.listFiles ).toHaveBeenCalledWith( mockFile );
			expect( mockBackupHandler.extractFiles ).toHaveBeenCalledWith( mockFile, mockExtractDir );
			expect( mockImporter.import ).toHaveBeenCalledWith( mockSite.path, mockSite.id );
			expect( fs.promises.rm ).toHaveBeenCalledWith( mockExtractDir, {
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

			expect( fs.promises.mkdtemp ).toHaveBeenCalled();
			expect( fs.promises.rm ).not.toHaveBeenCalled();
		} );

		it( 'should throw error if no suitable backup handler is found', async () => {
			vi.mocked( BackupHandlerFactory.create ).mockReturnValue( undefined );
			vi.mocked( fs.promises.stat ).mockResolvedValue( { size: 1024 } as Stats );

			await expect( importBackup( mockFile, mockSite, vi.fn(), [] ) ).rejects.toThrow(
				'No suitable backup handler found for the provided backup file'
			);

			expect( fs.promises.mkdtemp ).not.toHaveBeenCalled();
			expect( fs.promises.rm ).not.toHaveBeenCalled();
		} );
	} );
} );
