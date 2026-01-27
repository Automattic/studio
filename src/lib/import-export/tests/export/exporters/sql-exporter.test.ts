import { move } from 'fs-extra';
import { SqlExporter } from 'src/lib/import-export/export/exporters';
import { ExportOptions } from 'src/lib/import-export/export/types';
import { SiteServer } from 'src/site-server';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';

jest.mock( 'fs' );
jest.mock( 'fs/promises' );
jest.mock( 'os' );
jest.mock( 'fs-extra' );

// Mock SiteServer
jest.mock( 'src/site-server' );

platformTestSuite( 'SqlExporter', ( { normalize } ) => {
	let exporter: SqlExporter;
	let mockOptions: ExportOptions;

	beforeEach( () => {
		mockOptions = {
			site: {
				running: false,
				id: '123',
				name: '123',
				path: '/path/to/site',
				port: 9999,
				phpVersion: '8.3',
			},
			backupFile: normalize( '/path/to/backup.sql' ),
			includes: {
				database: true,
				wpContent: false,
			},
			phpVersion: '8.3',
		};

		// Reset all mock implementations
		jest.clearAllMocks();

		( SiteServer.get as jest.Mock ).mockReturnValue( {
			details: { path: normalize( '/path/to/site' ) },
			executeWpCliCommand: jest.fn().mockResolvedValue( { stderr: null } ),
		} );
		( move as jest.Mock ).mockResolvedValue( null );

		jest.useFakeTimers();
		jest.setSystemTime( new Date( '2024-08-01T12:00:00Z' ) );

		exporter = new SqlExporter( mockOptions );
	} );

	afterEach( () => {
		jest.useRealTimers();
	} );

	it( 'should call sqlite export command on the site server', async () => {
		await exporter.export();

		const siteServer = SiteServer.get( '123' );
		expect( siteServer?.executeWpCliCommand ).toHaveBeenCalledWith(
			'sqlite export /wordpress/studio-backup-db-export-2024-08-01-12-00-00.sql --require=/tmp/sqlite-command/command.php --enable-ast-driver',
			{ skipPluginsAndThemes: true }
		);
	} );

	it( 'should call move on the temporary file', async () => {
		await exporter.export();
		expect( move ).toHaveBeenCalledWith(
			normalize( '/path/to/site/studio-backup-db-export-2024-08-01-12-00-00.sql' ),
			mockOptions.backupFile
		);
	} );

	it( 'should return true when canHandle is called', async () => {
		const canHandle = await exporter.canHandle();
		expect( canHandle ).toBe( true );
	} );

	it( 'should return false when canHandle is called with invalid options', async () => {
		const exporter = new SqlExporter( {
			...mockOptions,
			backupFile: normalize( '/path/to/backup.zip' ),
		} );

		const canHandle = await exporter.canHandle();
		expect( canHandle ).toBe( false );
	} );
} );
