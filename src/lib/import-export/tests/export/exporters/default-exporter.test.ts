import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import archiver from 'archiver';
import { format } from 'date-fns';
import { SiteServer } from '../../../../../site-server';
import { DefaultExporter } from '../../../export/exporters';
import { ExportOptions, BackupContents } from '../../../export/types';

jest.mock( 'fs' );
jest.mock( 'fs/promises' );
jest.mock( 'os' );
jest.mock( 'fs-extra' );
jest.mock( 'date-fns', () => ( {
	format: jest.fn(),
} ) );

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
	return jest.fn( () => createMockArchiver() );
} );

// Mock SiteServer
jest.mock( '../../../../../site-server' );

describe( 'DefaultExporter', () => {
	let exporter: DefaultExporter;
	let mockBackup: BackupContents;
	let mockOptions: ExportOptions;
	let mockArchiver: jest.Mocked< PartialArchiver >;
	let mockWriteStream: { on: jest.Mock; path: string };

	const mockFiles = [
		{ path: '/path/to/site/wp-content/uploads', name: 'file1.jpg', isFile: () => true },
		{ path: '/path/to/site', name: 'wp-config.php', isFile: () => true },
		{ path: '/path/to/site/wp-content/plugins/plugin1', name: 'plugin1.php', isFile: () => true },
		{ path: '/path/to/site/wp-content/themes/theme1', name: 'index.php', isFile: () => true },
		{ path: '/path/to/site/wp-includes/index.php', name: 'index.php', isFile: () => true },
		{ path: '/path/to/site/wp-load.php', name: 'wp-load.php', isFile: () => true },
	];

	( fsPromises.readdir as jest.Mock ).mockResolvedValue( mockFiles );

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
			site: {
				running: false,
				id: '123',
				name: '123',
				path: '/path/to/site',
				phpVersion: '7.4',
			},
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
		( SiteServer.get as jest.Mock ).mockReturnValue( {
			details: { path: '/path/to/site' },
			executeWpCliCommand: jest.fn().mockResolvedValue( { stderr: null } ),
		} );

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
		( format as jest.Mock ).mockReturnValue( '2023-07-31-12-00-00' );

		mockArchiver.finalize.mockImplementation( () => {
			return new Promise< void >( ( resolve ) => {
				// Simulate async finalize
				setTimeout( () => {
					mockWriteStream.on.mock.calls.find( ( call ) => call[ 0 ] === 'close' )[ 1 ]();
					resolve();
				}, 0 );
			} );
		} );
		exporter = new DefaultExporter( mockOptions );
	} );

	it( 'should create a tar.gz archive', async () => {
		await exporter.export();

		expect( archiver ).toHaveBeenCalledWith( 'tar', { gzip: true, gzipOptions: { level: 9 } } );
	} );

	it( 'should create a zip archive when the backup file ends with .zip', async () => {
		mockOptions.backupFile = '/path/to/backup.zip';
		await exporter.export();

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

		const exporter = new DefaultExporter( options );
		await exporter.export();

		expect( mockArchiver.file ).toHaveBeenCalledWith( '/path/to/site/wp-config.php', {
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

		const exporter = new DefaultExporter( options );
		await exporter.export();
		// Check each expected call individually
		expect( mockArchiver.file ).toHaveBeenNthCalledWith( 1, '/path/to/site/wp-config.php', {
			name: 'wp-config.php',
		} );
		expect( mockArchiver.file ).toHaveBeenNthCalledWith(
			2,
			'/path/to/site/wp-content/uploads/file1.jpg',
			{ name: 'wp-content/uploads/file1.jpg' }
		);
		expect( mockArchiver.file ).toHaveBeenNthCalledWith(
			3,
			'/path/to/site/wp-content/plugins/plugin1/plugin1.php',
			{ name: 'wp-content/plugins/plugin1/plugin1.php' }
		);
		expect( mockArchiver.file ).toHaveBeenNthCalledWith(
			4,
			'/path/to/site/wp-content/themes/theme1/index.php',
			{ name: 'wp-content/themes/theme1/index.php' }
		);
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

		const exporter = new DefaultExporter( options );
		await exporter.export();

		expect( mockArchiver.file ).toHaveBeenNthCalledWith( 1, '/path/to/site/wp-config.php', {
			name: 'wp-config.php',
		} );
		expect( mockArchiver.file ).toHaveBeenNthCalledWith(
			2,
			'/tmp/studio_export_123/studio-backup-db-export-2023-07-31-12-00-00',
			{
				name: 'sql/studio-backup-db-export-2023-07-31-12-00-00',
			}
		);
	} );

	it( 'should finalize the archive', async () => {
		await exporter.export();

		expect( mockArchiver.finalize ).toHaveBeenCalled();
	} );

	it( 'should cleanup temporary files when database is included', async () => {
		mockBackup.sqlFiles = [ '/tmp/studio_export_123/file.sql' ];

		await exporter.export();

		expect( fsPromises.unlink ).toHaveBeenCalledWith(
			'/tmp/studio_export_123/studio-backup-db-export-2023-07-31-12-00-00'
		);
	} );

	it( 'should abort the archive and throw an error when an error occurs', async () => {
		const error = new Error( 'Archive error' );
		mockArchiver.file.mockImplementationOnce( () => {
			throw error;
		} );
		await expect( exporter.export() ).rejects.toThrow( 'Archive error' );
		expect( mockArchiver.abort ).toHaveBeenCalled();
	} );

	it( 'should return true when canHandle is called', async () => {
		const canHandle = await exporter.canHandle();
		expect( canHandle ).toBe( true );
	} );

	it( 'should return false when canHandle is called with invalid options', async () => {
		const exporter = new DefaultExporter( {
			...mockOptions,
			backupFile: '/path/to/backup.sql',
		} );

		const canHandle = await exporter.canHandle();
		expect( canHandle ).toBe( false );
	} );
} );
