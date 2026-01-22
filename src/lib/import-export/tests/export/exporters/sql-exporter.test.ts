import { move } from 'fs-extra';
import { vi } from 'vitest';
import { SqlExporter } from 'src/lib/import-export/export/exporters';
import { ExportOptions } from 'src/lib/import-export/export/types';
import { SiteServer } from 'src/site-server';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';

vi.mock( 'fs' );
vi.mock( 'fs/promises' );
vi.mock( 'os' );
vi.mock( 'fs-extra' );

// Mock SiteServer
vi.mock( 'src/site-server' );

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
		vi.clearAllMocks();

		vi.mocked( SiteServer.get, { partial: true } ).mockReturnValue( {
			details: {
				path: normalize( '/path/to/site' ),
				id: '123',
				name: 'Test Site',
				port: 9999,
				phpVersion: '8.3',
				running: false,
			},
			executeWpCliCommand: vi.fn().mockResolvedValue( { stdout: '', stderr: '', exitCode: 0 } ),
		} );
		vi.mocked( move ).mockResolvedValue();

		vi.useFakeTimers();
		vi.setSystemTime( new Date( '2024-08-01T12:00:00Z' ) );

		exporter = new SqlExporter( mockOptions );
	} );

	afterEach( () => {} );

	it( 'should call sqlite export command on the site server', async () => {
		await exporter.export();

		const siteServer = SiteServer.get( '123' );
		expect( siteServer?.executeWpCliCommand ).toHaveBeenCalledWith(
			'sqlite export studio-backup-db-export-2024-08-01-12-00-00.sql --require=/tmp/sqlite-command/command.php --enable-ast-driver',
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
