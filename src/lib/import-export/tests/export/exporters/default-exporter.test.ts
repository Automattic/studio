import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import archiver from 'archiver';
import { DefaultExporter } from '../../../export/exporters/default-exporter';
import { ExportOptions, BackupContents } from '../../../export/types';

jest.mock( 'fs' );
jest.mock( 'fs/promises' );
jest.mock( 'os' );

// Create a partial mock of the Archiver interface
type PartialArchiver = Pick<
	archiver.Archiver,
	'pipe' | 'file' | 'directory' | 'finalize' | 'on' | 'abort'
>;

const createMockArchiver = (): jest.Mocked< PartialArchiver > => {
	return {
		pipe: jest.fn().mockReturnThis(),
		file: jest.fn().mockReturnThis(),
		directory: jest.fn().mockReturnThis(),
		finalize: jest.fn().mockResolvedValue( undefined ),
		on: jest.fn().mockReturnThis(),
		abort: jest.fn(),
	};
};

// Mock archiver module
jest.mock( 'archiver', () => {
	return jest.fn().mockImplementation( () => createMockArchiver() );
} );

describe( 'DefaultExporter', () => {
	let exporter: DefaultExporter;
	let mockBackup: BackupContents;
	let mockOptions: ExportOptions;
	let mockArchiver: jest.Mocked< PartialArchiver >;
	let mockWriteStream: { on: jest.Mock; path: string };

	beforeEach( () => {
		mockBackup = {
			backupFile: '/path/to/backup.tar.gz',
			wpConfigFile: '/path/to/wp-config.php',
			sqlFiles: [ '/tmp/studio_export_123/file.sql' ],
			wpContent: {
				uploads: [ '/path/to/wp-content/uploads/file1.jpg' ],
				plugins: [ '/path/to/wp-content/plugins/plugin1' ],
				themes: [ '/path/to/wp-content/themes/theme1' ],
			},
		};

		mockOptions = {
			sitePath: '/path/to/site',
			backupFile: '/path/to/backup.tar.gz',
			includes: {
				uploads: true,
				plugins: true,
				themes: true,
				database: true,
			},
		};

		// Reset all mock implementations
		jest.clearAllMocks();

		mockArchiver = createMockArchiver();
		( archiver as jest.MockedFunction< typeof archiver > ).mockReturnValue(
			mockArchiver as unknown as archiver.Archiver
		);
		mockWriteStream = {
			on: jest.fn(),
			path: '/path/to/backup.tar.gz',
		};
		( fs.createWriteStream as jest.Mock ).mockReturnValue( mockWriteStream );
		( fsPromises.unlink as jest.Mock ).mockResolvedValue( undefined );
		( fsPromises.mkdtemp as jest.Mock ).mockResolvedValue( '/tmp/studio_export_123' );
		( fsPromises.writeFile as jest.Mock ).mockResolvedValue( undefined );
		( os.tmpdir as jest.Mock ).mockReturnValue( '/tmp' );

		mockArchiver.finalize.mockImplementation( () => {
			return new Promise< void >( ( resolve ) => {
				// Simulate async finalize
				setTimeout( () => {
					mockWriteStream.on.mock.calls.find( ( call ) => call[ 0 ] === 'close' )[ 1 ]();
					resolve();
				}, 0 );
			} );
		} );
		exporter = new DefaultExporter( mockBackup );
	} );

	it( 'should create a tar.gz archive', async () => {
		await exporter.export( mockOptions );

		expect( archiver ).toHaveBeenCalledWith( 'tar', { gzip: true, gzipOptions: { level: 9 } } );
	} );

	it( 'should create a zip archive when the backup file ends with .zip', async () => {
		mockOptions.backupFile = '/path/to/backup.zip';
		await exporter.export( mockOptions );

		expect( archiver ).toHaveBeenCalledWith( 'zip', { gzip: false, gzipOptions: undefined } );
	} );

	it( 'should add wp-config.php to the archive', async () => {
		const options = {
			...mockOptions,
			includes: {
				uploads: false,
				plugins: false,
				themes: false,
				database: false,
			},
		};
		await exporter.export( options );

		expect( mockArchiver.file ).toHaveBeenCalledWith( '/path/to/wp-config.php', {
			name: 'wp-config.php',
		} );
	} );

	it( 'should add wp-content files to the archive', async () => {
		const options = {
			...mockOptions,
			includes: {
				uploads: true,
				plugins: true,
				themes: true,
				database: false,
			},
		};
		await exporter.export( options );

		expect( mockArchiver.file ).toHaveBeenNthCalledWith( 1, '/path/to/wp-config.php', {
			name: 'wp-config.php',
		} );
		expect( mockArchiver.file ).toHaveBeenNthCalledWith(
			2,
			'/path/to/wp-content/uploads/file1.jpg',
			{
				name: '../wp-content/uploads/file1.jpg',
			}
		);
		expect( mockArchiver.file ).toHaveBeenNthCalledWith( 3, '/path/to/wp-content/plugins/plugin1', {
			name: '../wp-content/plugins/plugin1',
		} );
		expect( mockArchiver.file ).toHaveBeenNthCalledWith( 4, '/path/to/wp-content/themes/theme1', {
			name: '../wp-content/themes/theme1',
		} );
	} );

	it( 'should add a database file to the archive when database is included', async () => {
		const options = {
			...mockOptions,
			includes: {
				plugins: false,
				uploads: false,
				themes: false,
				database: true,
			},
		};
		( fsPromises.mkdtemp as jest.Mock ).mockResolvedValue( '/tmp/studio_export_123' );

		await exporter.export( options );

		expect( mockArchiver.file ).toHaveBeenNthCalledWith( 1, '/path/to/wp-config.php', {
			name: 'wp-config.php',
		} );
		expect( fsPromises.writeFile ).toHaveBeenCalledWith(
			'/tmp/studio_export_123/file.sql',
			'--test'
		);
		expect( mockArchiver.file ).toHaveBeenNthCalledWith( 2, '/tmp/studio_export_123/file.sql', {
			name: 'sql/file.sql',
		} );
	} );

	it( 'should finalize the archive', async () => {
		await exporter.export( mockOptions );

		expect( mockArchiver.finalize ).toHaveBeenCalled();
	} );

	it( 'should cleanup temporary files when database is included', async () => {
		mockBackup.sqlFiles = [ '/tmp/studio_export_123/file.sql' ];

		await exporter.export( mockOptions );

		expect( fsPromises.unlink ).toHaveBeenCalledWith( '/tmp/studio_export_123/file.sql' );
	} );

	it( 'should abort the archive and throw an error when an error occurs', async () => {
		const error = new Error( 'Archive error' );
		mockArchiver.file.mockImplementationOnce( () => {
			throw error;
		} );
		await expect( exporter.export( mockOptions ) ).rejects.toThrow( 'Archive error' );
		expect( mockArchiver.abort ).toHaveBeenCalled();
	} );
} );
