import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { vi } from 'vitest';
import yargs from 'yargs';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { ExportEvents } from 'cli/lib/import-export/export/events';
import { exportBackup } from 'cli/lib/import-export/export/export-manager';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { Logger, LoggerError } from 'cli/logger';
import { registerCommand, runCommand } from '../export';
import type { SiteData } from 'cli/lib/cli-config/core';

function getYargsArgvMock() {
	return yargs().option( 'path', {
		type: 'string',
		normalize: true,
		default: process.cwd(),
	} );
}

vi.mock( 'cli/lib/cli-config/sites', () => ( {
	getSiteByFolder: vi.fn(),
} ) );
vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'cli/lib/sqlite-integration' );
vi.mock( 'cli/lib/import-export/export/export-manager', () => ( {
	exportBackup: vi.fn(),
} ) );

describe( 'CLI: studio export', () => {
	const testSitePath = '/test/site';
	const testExportPath = '/tmp/site-backup.zip';
	const testSite: SiteData = {
		id: 'site-1',
		name: 'Test Site',
		path: testSitePath,
		port: 8080,
		phpVersion: '8.0',
		adminUsername: 'admin',
		adminPassword: 'password123',
	};

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( connectToDaemon ).mockResolvedValue( undefined );
		vi.mocked( disconnectFromDaemon ).mockResolvedValue( undefined );
		vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
		vi.mocked( keepSqliteIntegrationUpdated ).mockResolvedValue( false );
		vi.mocked( exportBackup ).mockResolvedValue( true );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'loads site and exports backup', async () => {
		await runCommand( testSitePath, testExportPath );

		expect( connectToDaemon ).toHaveBeenCalled();
		expect( getSiteByFolder ).toHaveBeenCalledWith( testSitePath );
		expect( keepSqliteIntegrationUpdated ).toHaveBeenCalledWith( testSitePath );
		expect( exportBackup ).toHaveBeenCalledWith(
			{
				site: testSite,
				backupFile: testExportPath,
				phpVersion: '8.3',
				includes: {
					wpContent: true,
					database: true,
				},
			},
			expect.any( Function )
		);
		expect( disconnectFromDaemon ).toHaveBeenCalled();
	} );

	it( 'maps export events to logger actions', async () => {
		const reportStartSpy = vi.spyOn( Logger.prototype, 'reportStart' );
		const reportProgressSpy = vi.spyOn( Logger.prototype, 'reportProgress' );
		const reportSuccessSpy = vi.spyOn( Logger.prototype, 'reportSuccess' );

		vi.mocked( exportBackup ).mockImplementation( async ( _options, onEvent ) => {
			onEvent( { event: ExportEvents.EXPORT_START, data: undefined } );
			onEvent( { event: ExportEvents.BACKUP_CREATE_START, data: undefined } );
			onEvent( {
				event: ExportEvents.BACKUP_CREATE_PROGRESS,
				data: { progress: { entries: { processed: 1, total: 2 } } },
			} );
			onEvent( { event: ExportEvents.EXPORT_COMPLETE, data: undefined } );
			return true;
		} );

		await runCommand( testSitePath, testExportPath );

		expect( reportStartSpy ).toHaveBeenCalledWith(
			LoggerAction.CREATE_BACKUP,
			'Creating backup file…'
		);
		expect( reportProgressSpy ).toHaveBeenCalledWith( 'Backing up file… (1 processed)' );
		expect( reportSuccessSpy ).toHaveBeenCalledWith( 'Starting export to site-backup.zip…' );
		expect( reportSuccessSpy ).toHaveBeenCalledWith( 'Site exported successfully' );
	} );

	it( 'throws when no suitable exporter is found', async () => {
		vi.mocked( exportBackup ).mockResolvedValue( false );

		const command = runCommand( testSitePath, testExportPath );
		await expect( command ).rejects.toThrow( LoggerError );
		await expect( command ).rejects.toThrow(
			'No suitable exporter found for the provided backup file'
		);
	} );

	it( 'allows .sql exports without --only db', async () => {
		const reportErrorSpy = vi.spyOn( Logger.prototype, 'reportError' );

		const argv = getYargsArgvMock();
		registerCommand( argv );

		await argv.parse( [ 'export', '/tmp/site-backup.sql', '--path', testSitePath ] );

		expect( exportBackup ).toHaveBeenCalledWith(
			expect.objectContaining( {
				backupFile: '/tmp/site-backup.sql',
			} ),
			expect.any( Function )
		);
		expect( reportErrorSpy ).not.toHaveBeenCalled();
	} );

	it( 'rejects .sql exports with --only content', async () => {
		const reportErrorSpy = vi.spyOn( Logger.prototype, 'reportError' );

		const argv = getYargsArgvMock();
		registerCommand( argv );

		await argv.parse( [
			'export',
			'/tmp/site-backup.sql',
			'--path',
			testSitePath,
			'--only',
			'content',
		] );

		expect( exportBackup ).not.toHaveBeenCalled();
		expect( reportErrorSpy ).toHaveBeenCalledWith(
			expect.objectContaining( {
				message:
					'Invalid export file extension. Must be .zip or .tar.gz when exporting site content.',
			} )
		);
	} );
} );
