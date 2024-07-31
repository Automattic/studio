import { rename } from 'fs-extra';
import { SiteServer } from '../../../../../site-server';
import { SqlExporter } from '../../../export/exporters';
import { ExportOptions } from '../../../export/types';

jest.mock( 'fs' );
jest.mock( 'fs/promises' );
jest.mock( 'os' );
jest.mock( 'fs-extra' );

// Mock SiteServer
jest.mock( '../../../../../site-server' );
( SiteServer.get as jest.Mock ).mockReturnValue( {
	details: { path: '/path/to/site' },
	executeWpCliCommand: jest.fn().mockReturnValue( { stderr: null } ),
} );

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
		};

		// Reset all mock implementations
		jest.clearAllMocks();

		// mock rename
		( rename as jest.Mock ).mockResolvedValue( null );
		Date.now = jest.fn( () => 123456 );
		exporter = new SqlExporter( mockOptions );
	} );

	it( 'should call rename on the temporary file', async () => {
		await exporter.export();

		expect( rename ).toHaveBeenCalledWith(
			'/path/to/site/temp_export_123456.sql',
			mockOptions.backupFile
		);
	} );

	it( 'should return true when canHandle is called', async () => {
		const canHandle = await exporter.canHandle();
		expect( canHandle ).toBe( true );
	} );
} );
