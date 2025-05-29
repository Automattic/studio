import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import archiver from 'archiver';
import { format } from 'date-fns';
import { DefaultExporter } from 'src/lib/import-export/export/exporters';
import { ExportOptions, BackupContents } from 'src/lib/import-export/export/types';
import { getWordPressVersionFromInstallation } from 'src/lib/wp-versions';
import { SiteServer } from 'src/site-server';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';

jest.mock( 'fs' );
jest.mock( 'fs/promises' );
jest.mock( 'os' );
jest.mock( 'fs-extra' );
jest.mock( 'date-fns', () => ( {
	format: jest.fn(),
} ) );
jest.mock( 'src/lib/wp-versions' );

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
jest.mock( 'src/site-server' );

const defaultTableNames = [
	'wp_commentmeta',
	'wp_comments',
	'wp_links',
	'wp_options',
	'wp_postmeta',
	'wp_posts',
	'wp_term_relationships',
	'wp_term_taxonomy',
	'wp_termmeta',
	'wp_terms',
];

// Silence `console.log`, `console.warn`, and `console.error` output
beforeAll( () => {
	jest.spyOn( console, 'log' ).mockImplementation( () => {} );
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
} );

afterAll( () => {
	jest.spyOn( console, 'log' ).mockRestore();
	jest.spyOn( console, 'warn' ).mockRestore();
	jest.spyOn( console, 'error' ).mockRestore();
} );

platformTestSuite( 'DefaultExporter', ( { normalize } ) => {
	let exporter: DefaultExporter;
	let mockBackup: BackupContents;
	let mockOptions: ExportOptions;
	let mockArchiver: jest.Mocked< PartialArchiver >;
	let mockWriteStream: { on: jest.Mock; path: string };

	( getWordPressVersionFromInstallation as jest.Mock ).mockResolvedValue( '6.6.1' );

	beforeEach( () => {
		const mockFiles = [
			{
				path: normalize( '/path/to/site/wp-content/uploads' ),
				name: 'file1.jpg',
				isFile: () => true,
			},
			{
				path: normalize( '/path/to/site' ),
				name: 'wp-config.php',
				isFile: () => true,
			},
			{
				path: normalize( '/path/to/site/wp-content/plugins/plugin1' ),
				name: 'plugin1.php',
				isFile: () => true,
			},
			{
				path: normalize( '/path/to/site/wp-content/themes/theme1' ),
				name: 'index.php',
				isFile: () => true,
			},
			{
				path: normalize( '/path/to/site/wp-includes' ),
				name: 'index.php',
				isFile: () => true,
			},
			{
				path: normalize( '/path/to/site' ),
				name: 'wp-load.php',
				isFile: () => true,
			},
			{
				path: normalize( '/path/to/site/wp-content/mu-plugins/sqlite-database-integration' ),
				name: 'load.php',
				isFile: () => true,
			},
			{
				path: normalize( '/path/to/site/wp-content/mu-plugins' ),
				name: '0-allowed-redirect-hosts.php',
				isFile: () => true,
			},
			{
				path: normalize( '/path/to/site/wp-content/mu-plugins' ),
				name: 'custom-mu-plugin.php',
				isFile: () => true,
			},
			{
				path: normalize( '/path/to/site/wp-content/fonts' ),
				name: 'custom-font.woff2',
				isFile: () => true,
			},
		];

		( fsPromises.readdir as jest.Mock ).mockResolvedValue( mockFiles );

		mockBackup = {
			backupFile: normalize( '/path/to/backup.tar.gz' ),
			wpConfigFile: normalize( '/path/to/wp-config.php' ),
			sqlFiles: [ normalize( '/tmp/studio_export_123/file.sql' ) ],
			wpContent: {
				uploads: [ normalize( '/path/to/wp-content/uploads/file1.jpg' ) ],
				plugins: [ normalize( '/path/to/wp-content/plugins/plugin1' ) ],
				themes: [ normalize( '/path/to/wp-content/themes/theme1' ) ],
				muPlugins: [ normalize( '/path/to/wp-content/mu-plugins/custom-mu-plugin.php' ) ],
				fonts: [ normalize( '/path/to/wp-content/fonts/custom-font.woff2' ) ],
			},
		};

		mockOptions = {
			site: {
				running: false,
				id: '123',
				name: '123',
				path: normalize( '/path/to/site' ),
				port: 9999,
				phpVersion: '8.3',
			},
			backupFile: normalize( '/path/to/backup.tar.gz' ),
			includes: {
				uploads: true,
				plugins: true,
				themes: true,
				database: true,
				muPlugins: true,
				fonts: true,
			},
			phpVersion: '8.4',
		};

		// Reset all mock implementations
		jest.clearAllMocks();

		( SiteServer.get as jest.Mock ).mockReturnValue( {
			details: { path: normalize( '/path/to/site' ) },
			executeWpCliCommand: jest.fn( function ( command: string ) {
				switch ( true ) {
					case /plugin list/.test( command ):
						return { stdout: '[{"name":"akismet","status":"active","version":"5.3.3"}]' };
					case /theme list/.test( command ):
						return { stdout: '[{"name":"twentytwentyfour","status":"active","version":"1.0"}]' };
					case /tables/.test( command ):
						return { stdout: JSON.stringify( defaultTableNames ) };
					default:
						return { stderr: null };
				}
			} ),
		} );

		mockArchiver = createMockArchiver();
		( archiver as jest.MockedFunction< typeof archiver > ).mockReturnValue(
			mockArchiver as unknown as archiver.Archiver
		);
		mockWriteStream = {
			on: jest.fn(),
			path: normalize( '/path/to/backup.tar.gz' ),
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

		expect( archiver ).toHaveBeenCalledWith( 'tar', {
			followSymlinks: true,
			gzip: true,
			gzipOptions: { level: 9 },
		} );
	} );

	it( 'should create a zip archive when the backup file ends with .zip', async () => {
		mockOptions.backupFile = '/path/to/backup.zip';
		await exporter.export();

		expect( archiver ).toHaveBeenCalledWith( 'zip', { followSymlinks: true, zlib: { level: 9 } } );
	} );

	it( 'should add wp-config.php to the archive', async () => {
		const options = {
			...mockOptions,
			includes: {
				uploads: false,
				plugins: false,
				themes: false,
				database: false,
				muPlugins: false,
				fonts: false,
			},
		};

		const exporter = new DefaultExporter( options );
		await exporter.export();

		expect( mockArchiver.file ).toHaveBeenCalledWith( normalize( '/path/to/site/wp-config.php' ), {
			name: 'wp-config.php',
		} );
	} );

	it( 'should add meta.json to the archive', async () => {
		const exporter = new DefaultExporter( mockOptions );
		await exporter.export();

		expect( getWordPressVersionFromInstallation ).toHaveBeenCalledTimes( 1 );
		expect( getWordPressVersionFromInstallation ).toHaveBeenCalledWith(
			normalize( '/path/to/site' )
		);
		expect( mockArchiver.file ).toHaveBeenCalledWith(
			normalize( '/tmp/studio_export_123/meta.json' ),
			{ name: 'meta.json' }
		);
	} );

	it( 'should add wp-content directories to the archive', async () => {
		const options = {
			...mockOptions,
			includes: {
				uploads: true,
				plugins: true,
				themes: true,
				database: false,
				muPlugins: false,
				fonts: true,
			},
		};

		const exporter = new DefaultExporter( options );
		await exporter.export();
		// Check each expected call individually
		expect( mockArchiver.file ).toHaveBeenNthCalledWith(
			1,
			normalize( '/path/to/site/wp-config.php' ),
			{ name: 'wp-config.php' }
		);
		expect( mockArchiver.directory ).toHaveBeenNthCalledWith(
			1,
			normalize( '/path/to/site/wp-content/uploads' ),
			normalize( 'wp-content/uploads' ),
			expect.any( Function )
		);
		expect( mockArchiver.directory ).toHaveBeenNthCalledWith(
			2,
			normalize( '/path/to/site/wp-content/plugins' ),
			normalize( 'wp-content/plugins' ),
			expect.any( Function )
		);
		expect( mockArchiver.directory ).toHaveBeenNthCalledWith(
			3,
			normalize( '/path/to/site/wp-content/themes' ),
			normalize( 'wp-content/themes' ),
			expect.any( Function )
		);
		expect( mockArchiver.directory ).toHaveBeenNthCalledWith(
			4,
			normalize( '/path/to/site/wp-content/fonts' ),
			normalize( 'wp-content/fonts' ),
			expect.any( Function )
		);
	} );

	it( 'should add (non-excluded) mu-plugins files to the archive', async () => {
		const options = {
			...mockOptions,
			includes: {
				uploads: false,
				plugins: false,
				themes: false,
				database: false,
				muPlugins: true,
				fonts: false,
			},
		};

		const exporter = new DefaultExporter( options );
		await exporter.export();

		expect( mockArchiver.file ).toHaveBeenNthCalledWith(
			1,
			normalize( '/path/to/site/wp-config.php' ),
			{ name: 'wp-config.php' }
		);
		expect( mockArchiver.directory ).toHaveBeenNthCalledWith(
			1,
			normalize( '/path/to/site/wp-content/mu-plugins' ),
			normalize( 'wp-content/mu-plugins' ),
			expect.any( Function )
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
				muPlugins: false,
				fonts: false,
			},
		};
		( fsPromises.mkdtemp as jest.Mock ).mockResolvedValue( normalize( '/tmp/studio_export_123' ) );

		const exporter = new DefaultExporter( options );
		await exporter.export();

		expect( mockArchiver.file ).toHaveBeenNthCalledWith(
			1,
			normalize( '/path/to/site/wp-config.php' ),
			{ name: 'wp-config.php' }
		);
		expect( mockArchiver.file ).toHaveBeenNthCalledWith(
			2,
			normalize( '/tmp/studio_export_123/studio-backup-db-export-2023-07-31-12-00-00.sql' ),
			{ name: 'sql/studio-backup-db-export-2023-07-31-12-00-00.sql' }
		);
	} );

	it( 'should add a multiple SQL dumps to the archive when `splitDatabaseDumpByTable` is true', async () => {
		const options = {
			...mockOptions,
			includes: {
				plugins: false,
				uploads: false,
				themes: false,
				database: true,
				muPlugins: false,
				fonts: false,
			},
			splitDatabaseDumpByTable: true,
		};
		( fsPromises.mkdtemp as jest.Mock ).mockResolvedValue( normalize( '/tmp/studio_export_123' ) );

		const exporter = new DefaultExporter( options );
		await exporter.export();

		expect( mockArchiver.file ).toHaveBeenNthCalledWith(
			1,
			normalize( '/path/to/site/wp-config.php' ),
			{ name: 'wp-config.php' }
		);

		for ( const tableName of defaultTableNames ) {
			expect( mockArchiver.file ).toHaveBeenCalledWith(
				normalize( `/tmp/studio_export_123/${ tableName }.sql` ),
				{ name: `sql/${ tableName }.sql` }
			);
		}
	} );

	it( 'should finalize the archive', async () => {
		await exporter.export();

		expect( mockArchiver.finalize ).toHaveBeenCalled();
	} );

	it( 'should cleanup temporary files when database is included', async () => {
		mockBackup.sqlFiles = [ normalize( '/tmp/studio_export_123/file.sql' ) ];

		await exporter.export();

		expect( fsPromises.unlink ).toHaveBeenCalledWith(
			normalize( '/tmp/studio_export_123/studio-backup-db-export-2023-07-31-12-00-00.sql' )
		);
	} );

	it( 'should abort the archive and throw an error when an error occurs', async () => {
		const error = new Error( 'Archive error' );
		mockArchiver.file.mockImplementationOnce( () => {
			throw error;
		} );
		await expect( exporter.export() ).rejects.toThrow( 'Archive error' );
		expect( mockArchiver.abort ).toHaveBeenCalled();
		expect( getWordPressVersionFromInstallation ).toHaveBeenCalledTimes( 0 );
	} );

	it( 'should return true when canHandle is called', async () => {
		const canHandle = await exporter.canHandle();
		expect( canHandle ).toBe( true );
	} );

	it( 'should return false when canHandle is called with invalid options', async () => {
		const exporter = new DefaultExporter( {
			...mockOptions,
			backupFile: normalize( '/path/to/backup.sql' ),
		} );

		const canHandle = await exporter.canHandle();
		expect( canHandle ).toBe( false );
	} );

	it( 'should fail when can not get plugin or theme details', async () => {
		( SiteServer.get as jest.Mock ).mockReturnValue( {
			details: { path: normalize( '/path/to/site' ) },
			executeWpCliCommand: jest.fn( function ( command: string ) {
				switch ( true ) {
					case /plugin list/.test( command ):
					case /theme list/.test( command ):
						return { stdout: '<a><br/>some html</ap>', stderr: 'Error' };
					default:
						return { stderr: null };
				}
			} ),
		} );

		const exporter = new DefaultExporter( mockOptions );

		await expect( exporter.export() ).rejects.toThrow(
			'Could not get information about installed plugins to create meta.json file.'
		);
	} );

	it( 'should add fonts files to the archive when fonts is included', async () => {
		const options = {
			...mockOptions,
			includes: {
				uploads: false,
				plugins: false,
				themes: false,
				database: false,
				muPlugins: false,
				fonts: true,
			},
		};

		const exporter = new DefaultExporter( options );
		await exporter.export();

		expect( mockArchiver.file ).toHaveBeenNthCalledWith(
			1,
			normalize( '/path/to/site/wp-config.php' ),
			{ name: 'wp-config.php' }
		);
		expect( mockArchiver.directory ).toHaveBeenNthCalledWith(
			1,
			normalize( '/path/to/site/wp-content/fonts' ),
			normalize( 'wp-content/fonts' ),
			expect.any( Function )
		);
	} );
} );
