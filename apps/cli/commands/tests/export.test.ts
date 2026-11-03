import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as configFile from '@studio/common/lib/cli-config-file';
import { ExportEvents } from '@studio/common/lib/import-export-events';
import { getCliConfigPath } from '@studio/common/lib/well-known-paths';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { vi } from 'vitest';
import yargs from 'yargs';
import * as configStore from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { ImportExportEventEmitter } from 'cli/lib/import-export/events';
import { getExporter } from 'cli/lib/import-export/export/export-manager';
import { withSiteOperation } from 'cli/lib/site-operations';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { Logger, LoggerError } from 'cli/logger';
import { runCommand } from '../export';
import { registerCommand } from '../export.command';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.unmock( 'lockfile' );

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
vi.mock( 'cli/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('cli/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );

vi.mock( 'cli/lib/site-operations', () => ( {
	withSiteOperation: vi.fn( ( _folder: string, _kind: string, fn: () => unknown ) => fn() ),
} ) );

let configDirectory: string;
const siteTracksId = '6ad36785-267a-4e6d-b036-0a7460c76497';
beforeEach( async () => {
	configDirectory = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio-event-tracks-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', configDirectory );
	await fsPromises.writeFile(
		getCliConfigPath(),
		JSON.stringify( {
			version: 1,
			sites: [
				{
					id: 'site-1',
					name: 'Private site title',
					path: '/test/site',
					port: 8080,
					phpVersion: '8.3',
					tracksId: siteTracksId,
				},
			],
			snapshots: [],
		} )
	);
} );
afterEach( async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await fsPromises.rm( configDirectory, { recursive: true, force: true } );
} );

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

		expect( getExporter ).toHaveBeenCalledWith(
			expect.objectContaining( {
				backupFile: testExportPath,
				includes: { wpContent: true, database: true },
			} )
		);
		expect( withSiteOperation ).toHaveBeenCalledWith(
			testSitePath,
			'export',
			expect.any( Function )
		);
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

	it( 'records a success Tracks event with the export mode', async () => {
		await runCommand( testSitePath, testExportPath );

		expect( recordTracksEvent ).toHaveBeenCalledTimes( 1 );
		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.SITE_EXPORT,
			expect.objectContaining( {
				success: true,
				export_type: 'full',
				time_ms: expect.any( Number ),
				channel: 'studio-cli',
				site_id: siteTracksId,
			} )
		);
		expect( vi.mocked( recordTracksEvent ).mock.calls[ 0 ][ 1 ] ).not.toHaveProperty(
			'failure_reason'
		);
	} );

	it( 'records a failure Tracks event when no exporter is found', async () => {
		vi.mocked( getExporter ).mockResolvedValue( null as never );

		await expect( runCommand( testSitePath, testExportPath ) ).rejects.toThrow(
			'No suitable exporter'
		);

		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.SITE_EXPORT,
			expect.objectContaining( {
				success: false,
				export_type: 'full',
				failure_reason: 'no_exporter_found',
				site_id: siteTracksId,
				time_ms: expect.any( Number ),
			} )
		);
	} );

	it( 'records a failure Tracks event when the exporter fails', async () => {
		vi.mocked( getExporter ).mockResolvedValue(
			createExporter( async () => {
				throw new LoggerError( 'Database export failed', undefined, 'database_export' );
			} ) as never
		);

		await expect( runCommand( testSitePath, testExportPath ) ).rejects.toThrow(
			'Database export failed'
		);

		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.SITE_EXPORT,
			expect.objectContaining( {
				success: false,
				failure_reason: 'database_export',
				site_id: siteTracksId,
			} )
		);
	} );

	it( 'does not record a Tracks event when suppressed', async () => {
		await runCommand( testSitePath, testExportPath, 'full', false, undefined, false, true );

		vi.mocked( getExporter ).mockResolvedValue( null as never );
		await expect(
			runCommand( testSitePath, testExportPath, 'full', false, undefined, false, true )
		).rejects.toThrow( 'No suitable exporter' );

		expect( recordTracksEvent ).not.toHaveBeenCalled();
	} );

	it.each( [ '', 'studio-ui:v2' ] )(
		'reuses and backfills the site UUID for export (origin %s)',
		async ( origin ) => {
			vi.stubEnv( 'STUDIO_TRACKS_ORIGIN', origin );
			const config = await configStore.readCliConfig();
			delete config.sites[ 0 ].tracksId;
			await configStore.lockCliConfig();
			try {
				await configStore.saveCliConfig( config );
			} finally {
				await configStore.unlockCliConfig();
			}
			await Promise.all( [
				runCommand( testSitePath, testExportPath ),
				runCommand( testSitePath, testExportPath ),
			] );
			const calls = vi.mocked( recordTracksEvent ).mock.calls;
			const stored = ( await configStore.readCliConfig() ).sites[ 0 ].tracksId;
			expect( stored ).toMatch( /^[0-9a-f-]{36}$/ );
			expect( calls.map( ( [ , props ] ) => props?.site_id ) ).toEqual( [ stored, stored ] );
			expect( calls[ 0 ][ 1 ] ).not.toHaveProperty( 'preview_id' );
		}
	);
	it( 'omits the site UUID when no local record can be resolved', async () => {
		vi.mocked( getSiteByFolder ).mockRejectedValueOnce( new Error( 'Missing site' ) );
		await expect( runCommand( '/missing', testExportPath ) ).rejects.toThrow( 'Missing site' );
		expect( recordTracksEvent ).toHaveBeenCalledTimes( 1 );
		expect( vi.mocked( recordTracksEvent ).mock.calls[ 0 ][ 1 ] ).not.toHaveProperty( 'site_id' );
	} );
	it.each( [
		'lockCliConfigFile',
		'readCliConfigFileRaw',
		'writeCliConfigFileRaw',
		'unlockCliConfigFile',
	] as const )( 'keeps export and its event when ID %s fails', async ( operation ) => {
		const config = await configStore.readCliConfig();
		delete config.sites[ 0 ].tracksId;
		await configStore.lockCliConfig();
		try {
			await configStore.saveCliConfig( config );
		} finally {
			await configStore.unlockCliConfig();
		}
		vi.spyOn( configFile, operation ).mockRejectedValueOnce( new Error( 'Storage failed' ) );
		await expect( runCommand( testSitePath, testExportPath ) ).resolves.toBeUndefined();
		expect( recordTracksEvent ).toHaveBeenCalledExactlyOnceWith(
			TRACKS_EVENTS.SITE_EXPORT,
			expect.objectContaining( { success: true, export_type: 'full' } )
		);
		expect( vi.mocked( recordTracksEvent ).mock.calls[ 0 ][ 1 ] ).not.toHaveProperty( 'site_id' );
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
