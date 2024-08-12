import { move } from 'fs-extra';
import { SiteServer } from '../../../../../site-server';
import { SqlExporter } from '../../../export/exporters';
import { ExportOptions } from '../../../export/types';

jest.mock( 'fs' );
jest.mock( 'fs/promises' );
jest.mock( 'os' );
jest.mock( 'fs-extra' );

// Mock SiteServer
jest.mock( '../../../../../site-server' );

describe( 'SqlExporter', () => {
	let exporter: SqlExporter;
	let mockOptions: ExportOptions;

	beforeEach( () => {
		mockOptions = {
			site: {
				running: false,
				id: '123',
				name: '123',
				path: '/path/to/site',
				phpVersion: '7.4',
			},
			backupFile: '/path/to/backup.sql',
			includes: {
				uploads: false,
				plugins: false,
				themes: false,
				database: true,
			},
			phpVersion: '7.4',
		};

		// Reset all mock implementations
		jest.clearAllMocks();

		( SiteServer.get as jest.Mock ).mockReturnValue( {
			details: { path: '/path/to/site' },
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
			'sqlite export studio-backup-db-export-2024-08-01-12-00-00.sql --require=/tmp/sqlite-command/command.php'
		);
	} );

	it( 'should call move on the temporary file', async () => {
		await exporter.export();
		expect( move ).toHaveBeenCalledWith(
			'/path/to/site/studio-backup-db-export-2024-08-01-12-00-00.sql',
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
			backupFile: '/path/to/backup.zip',
		} );

		const canHandle = await exporter.canHandle();
		expect( canHandle ).toBe( false );
	} );
} );
