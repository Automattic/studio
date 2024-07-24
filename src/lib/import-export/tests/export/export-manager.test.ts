import fs from 'fs/promises';
import path from 'path';
import { exportBackup } from '../../export/export-manager';
import { ExportOptions, ExporterOption, BackupContents } from '../../export/types';

jest.mock( 'fs/promises' );
jest.mock( 'path' );
jest.mock( '../../export/validators/wordpress-validator' );
jest.mock( '../../export/exporters' );

describe( 'exportBackup', () => {
	const mockSitePath = '/mock/site/path';
	const mockExportOptions: ExportOptions = {
		sitePath: mockSitePath,
		backupFile: '/mock/backup/path/backup.tar.gz',
		includes: {
			database: true,
			uploads: true,
			plugins: true,
			themes: true,
		},
	};

	const mockFiles = [
		'wp-config.php',
		'wp-content/uploads/image.jpg',
		'wp-content/plugins/plugin.php',
		'wp-content/themes/theme/style.css',
	];

	const expectedFiles = mockFiles.map( ( file ) => `${ mockSitePath }/${ file }` );

	beforeEach( () => {
		jest.clearAllMocks();
		( fs.readdir as jest.Mock ).mockResolvedValue(
			mockFiles.map( ( file ) => ( {
				isFile: () => true,
				path: mockSitePath,
				name: file,
			} ) )
		);
		( path.join as jest.Mock ).mockImplementation( ( ...args ) => args.join( '/' ) );
	} );

	it( 'should call the correct exporter when validator can handle files', async () => {
		const mockValidator = {
			canHandle: jest.fn().mockReturnValue( true ),
			filterFiles: jest.fn().mockReturnValue( {} as BackupContents ),
			on: jest.fn(),
			emit: jest.fn(),
		};
		const mockExportMethod = jest.fn().mockResolvedValue( undefined );

		const MockExporter = jest.fn().mockImplementation( () => ( {
			export: mockExportMethod,
			on: jest.fn(),
			emit: jest.fn(),
		} ) );
		const options: ExporterOption[] = [ { validator: mockValidator, exporter: MockExporter } ];

		await exportBackup( mockExportOptions, jest.fn(), options );

		expect( mockValidator.canHandle ).toHaveBeenCalledWith( expectedFiles );
		expect( mockValidator.filterFiles ).toHaveBeenCalledWith( expectedFiles, mockExportOptions );
		expect( MockExporter ).toHaveBeenCalled();
		expect( mockExportMethod ).toHaveBeenCalledWith( mockExportOptions );
	} );

	it( 'should not call exporter when no validator can handle files', async () => {
		const mockValidator = {
			canHandle: jest.fn().mockReturnValue( false ),
			filterFiles: jest.fn(),
			on: jest.fn(),
			emit: jest.fn(),
		};
		const MockExporter = jest.fn().mockImplementation( () => ( {
			export: jest.fn(),
			on: jest.fn(),
			emit: jest.fn(),
		} ) );
		const options: ExporterOption[] = [ { validator: mockValidator, exporter: MockExporter } ];

		await exportBackup( mockExportOptions, jest.fn(), options );

		expect( mockValidator.canHandle ).toHaveBeenCalledWith( expectedFiles );
		expect( mockValidator.filterFiles ).not.toHaveBeenCalled();
		expect( MockExporter ).not.toHaveBeenCalled();
	} );

	it( 'should throw an error if fs.readdir fails', async () => {
		const fsError = new Error( 'File system error' );
		( fs.readdir as jest.Mock ).mockRejectedValue( fsError );

		await expect( exportBackup( mockExportOptions, jest.fn() ) ).rejects.toThrow( fsError );
	} );
} );
