import { ExportEvents } from '@studio/common/lib/import-export-events';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { vi } from 'vitest';
import yargs from 'yargs';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { ImportExportEventEmitter } from 'cli/lib/import-export/events';
import { getExporter } from 'cli/lib/import-export/export/export-manager';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { Logger, LoggerError } from 'cli/logger';
import { registerCommand, runCommand } from '../export';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( '@studio/common/lib/deploy-ignore', () => ( {
	createDeployIgnoreFilter: vi.fn().mockResolvedValue( { ignores: vi.fn() } ),
} ) );

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
vi.mock( import( 'cli/lib/import-export/export/export-manager' ), () => ( {
	getExporter: vi.fn(),
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

	class MockExporter extends ImportExportEventEmitter {
		constructor( private exportImpl: () => Promise< void > ) {
			super();
		}
		export = vi.fn( async () => this.exportImpl() );
		canHandle = vi.fn( async () => true );
	}

	const createExporter = ( exportImpl: () => Promise< void > = async () => {} ) =>
		new MockExporter( exportImpl );

	beforeEach( () => {
		vi.clearAllMocks();

		// Stub process.send to undefined so export.ts takes the logger event
		// handler path rather than the IPC one. With pool:forks, process.send is
		// defined (the forked process reports results via it), so without this
		// stub the tests would exercise the wrong code path. Restored via
		// vi.unstubAllGlobals() in afterEach. See AINFRA-2475.
		vi.stubGlobal( 'process', { ...process, send: undefined } );

		vi.mocked( connectToDaemon ).mockResolvedValue( undefined );
		vi.mocked( disconnectFromDaemon ).mockResolvedValue( undefined );
		vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
		vi.mocked( keepSqliteIntegrationUpdated ).mockResolvedValue( undefined );
		vi.mocked( getExporter ).mockResolvedValue( createExporter() as never );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	} );

	it( 'loads site and exports backup', async () => {
		await runCommand( testSitePath, testExportPath );

		expect( connectToDaemon ).toHaveBeenCalled();
		expect( getSiteByFolder ).toHaveBeenCalledWith( testSitePath );
		expect( keepSqliteIntegrationUpdated ).toHaveBeenCalledWith( testSitePath );
		expect( getExporter ).toHaveBeenCalledWith( {
			site: testSite,
			backupFile: testExportPath,
			phpVersion: '8.4',
			includes: {
				wpContent: true,
				database: true,
			},
			specificSelectionPaths: undefined,
			splitDatabaseDumpByTable: false,
			ignoreFilter: undefined,
		} );
		expect( disconnectFromDaemon ).toHaveBeenCalled();
	} );

	it( 'applies deploy-ignore filter when applyDeployIgnore is set', async () => {
		await runCommand( testSitePath, testExportPath, 'full', false, undefined, true );

		expect( getExporter ).toHaveBeenCalledWith(
			expect.objectContaining( {
				ignoreFilter: expect.objectContaining( { ignores: expect.any( Function ) } ),
			} )
		);
	} );

	it( 'maps export events to logger actions', async () => {
		const reportStartSpy = vi.spyOn( Logger.prototype, 'reportStart' );
		const reportProgressSpy = vi.spyOn( Logger.prototype, 'reportProgress' );
		const reportSuccessSpy = vi.spyOn( Logger.prototype, 'reportSuccess' );

		const exporter = createExporter( async () => {
			exporter.emit( ExportEvents.EXPORT_START );
			exporter.emit( ExportEvents.BACKUP_CREATE_START );
			exporter.emit( ExportEvents.BACKUP_CREATE_PROGRESS, {
				progress: {
					entries: { processed: 1, total: 2 },
					fs: { processedBytes: 1024, totalBytes: 2048 },
				},
			} );
			exporter.emit( ExportEvents.EXPORT_COMPLETE );
		} );
		vi.mocked( getExporter ).mockResolvedValue( exporter as never );

		await runCommand( testSitePath, testExportPath );

		expect( reportStartSpy ).toHaveBeenCalledWith( LoggerAction.EXPORT_SITE, 'Starting export…' );
		expect( reportStartSpy ).toHaveBeenCalledWith(
			LoggerAction.CREATE_BACKUP,
			'Creating backup file…'
		);
		expect( reportProgressSpy ).toHaveBeenCalledWith( 'Backing up file… (1 processed)' );
		expect( reportSuccessSpy ).toHaveBeenCalledWith( 'Site exported successfully' );
	} );

	it( 'throws when no suitable exporter is found', async () => {
		vi.mocked( getExporter ).mockResolvedValue( null as never );

		const command = runCommand( testSitePath, testExportPath );
		await expect( command ).rejects.toThrow( LoggerError );
		await expect( command ).rejects.toThrow(
			'No suitable exporter found for the provided backup file'
		);
	} );

	it( 'allows .sql exports when --mode db is used', async () => {
		const reportErrorSpy = vi.spyOn( Logger.prototype, 'reportError' );

		const argv = getYargsArgvMock();
		registerCommand( argv );

		await argv.parse( [ 'export', 'site-backup.sql', '--path', testSitePath, '--mode', 'db' ] );

		expect( getExporter ).toHaveBeenCalledWith(
			expect.objectContaining( {
				backupFile: expect.stringContaining( 'site-backup.sql' ),
				includes: {
					database: true,
					wpContent: false,
				},
			} )
		);
		expect( reportErrorSpy ).not.toHaveBeenCalled();
	} );

	it( 'rejects .sql exports with --mode full', async () => {
		const reportErrorSpy = vi.spyOn( Logger.prototype, 'reportError' );

		const argv = getYargsArgvMock();
		registerCommand( argv );

		await argv.parse( [ 'export', 'site-backup.sql', '--path', testSitePath, '--mode', 'full' ] );

		expect( getExporter ).not.toHaveBeenCalled();
		expect( reportErrorSpy ).toHaveBeenCalledWith(
			expect.objectContaining( {
				message:
					'Invalid export file extension. Must be .zip or .tar.gz when exporting the full site.',
			} )
		);
	} );
} );
