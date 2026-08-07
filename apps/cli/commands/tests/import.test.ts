import fs from 'fs';
import path from 'path';
import { isWordPressDirectory, recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import { ImporterEvents, ValidatorEvents } from '@studio/common/lib/import-export-events';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { vi } from 'vitest';
import { getSiteByFolder, updateSitePhpVersion } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { ImportExportEventEmitter } from 'cli/lib/import-export/events';
import { DEFAULT_IMPORTER_OPTIONS, getImporter } from 'cli/lib/import-export/import/import-manager';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { runCommand } from '../import';
import type { SiteData } from 'cli/lib/cli-config/core';
import type { ImporterResult } from 'cli/lib/import-export/import/importers/importer';

vi.mock( 'cli/lib/cli-config/sites', () => ( {
	clearSiteLatestCliPid: vi.fn(),
	getSiteByFolder: vi.fn(),
	getSiteUrl: vi.fn(),
	updateSitePhpVersion: vi.fn(),
} ) );
vi.mock( 'cli/lib/daemon-client' );
// Pass through the lease: these suites cover the command, not the lock
// (lib/tests/site-lock.test.ts does that). Spreading the real module keeps
// any other export real rather than silently stubbing it.
vi.mock( 'cli/lib/site-lock', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/site-lock') >() ),
	withSiteLock: ( _folder: string, _kind: string, fn: () => unknown ) => fn(),
} ) );
vi.mock( 'cli/lib/sqlite-integration', () => ( {
	keepSqliteIntegrationUpdated: vi.fn(),
} ) );
vi.mock( 'cli/lib/wordpress-server-manager', () => ( {
	isServerRunning: vi.fn(),
	stopWordPressServer: vi.fn(),
} ) );
vi.mock( import( 'cli/lib/import-export/import/import-manager' ), () => ( {
	DEFAULT_IMPORTER_OPTIONS: [],
	getImporter: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/well-known-paths' );
vi.mock( '@studio/common/lib/fs-utils', () => ( {
	isWordPressDirectory: vi.fn(),
	recursiveCopyDirectory: vi.fn(),
} ) );

describe( 'CLI: studio import', () => {
	const testSitePath = '/test/site';
	const testImportPath = '/tmp/backup.zip';
	const testSite: SiteData = {
		id: 'site-1',
		name: 'Test Site',
		path: testSitePath,
		port: 8080,
		phpVersion: '8.0',
		adminUsername: 'admin',
		adminPassword: 'password123',
	};
	const importResult: ImporterResult = {
		extractionDirectory: '/tmp/extracted',
		sqlFiles: [],
		wpContentFiles: [],
		wpContentDirectory: '/tmp/extracted/wp-content',
		wpConfig: '/tmp/extracted/wp-config.php',
	};

	class MockImporter extends ImportExportEventEmitter {
		constructor( private importImpl: () => Promise< ImporterResult > ) {
			super();
		}
		import = vi.fn( async () => this.importImpl() );
	}

	const createImporter = (
		importImpl: () => Promise< ImporterResult > = async () => importResult
	) => new MockImporter( importImpl );

	beforeEach( () => {
		vi.clearAllMocks();

		// Stub process.send to undefined so import.ts takes the logger event
		// handler path rather than the IPC one. With pool:forks, process.send is
		// defined (the forked process reports results via it), so without this
		// stub the tests would exercise the wrong code path. Restored via
		// vi.unstubAllGlobals() in afterEach. See AINFRA-2475.
		vi.stubGlobal( 'process', { ...process, send: undefined } );

		vi.mocked( connectToDaemon ).mockResolvedValue( undefined );
		vi.mocked( disconnectFromDaemon ).mockResolvedValue( undefined );
		vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
		vi.mocked( isServerRunning ).mockResolvedValue( undefined );
		vi.mocked( stopWordPressServer ).mockResolvedValue( undefined );
		vi.mocked( keepSqliteIntegrationUpdated ).mockResolvedValue( undefined );
		vi.mocked( isWordPressDirectory ).mockReturnValue( true );
		vi.mocked( getServerFilesPath ).mockReturnValue( '/server-files' );
		vi.mocked( recursiveCopyDirectory ).mockResolvedValue( undefined );
		vi.spyOn( fs, 'existsSync' ).mockImplementation( ( p ) => p === testImportPath );
		vi.mocked( getImporter ).mockReturnValue( createImporter() as never );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	} );

	it( 'loads site and imports backup', async () => {
		await runCommand( testSitePath, testImportPath );

		expect( connectToDaemon ).toHaveBeenCalled();
		expect( getSiteByFolder ).toHaveBeenCalledWith( testSitePath );
		expect( getImporter ).toHaveBeenCalledWith(
			{
				path: testImportPath,
				type: 'application/zip',
			},
			DEFAULT_IMPORTER_OPTIONS
		);
		expect( disconnectFromDaemon ).toHaveBeenCalled();
	} );

	it( 'updates site PHP version from import metadata when available', async () => {
		const importer = createImporter( async () => ( {
			...importResult,
			meta: {
				phpVersion: '8.3',
			},
		} ) );
		vi.mocked( getImporter ).mockReturnValue( importer as never );

		await runCommand( testSitePath, testImportPath );

		expect( updateSitePhpVersion ).toHaveBeenCalledWith( testSite.id, '8.3' );
	} );

	it( 'sets up WordPress files when site path is not a WordPress directory', async () => {
		vi.mocked( isWordPressDirectory ).mockReturnValue( false );
		vi.spyOn( fs, 'existsSync' ).mockImplementation(
			( p ) =>
				p === testImportPath || p === path.join( '/server-files', 'wordpress-versions', 'latest' )
		);

		await runCommand( testSitePath, testImportPath );

		expect( recursiveCopyDirectory ).toHaveBeenCalledWith(
			path.join( '/server-files', 'wordpress-versions', 'latest' ),
			testSitePath
		);
	} );

	it( 'throws when bundled WordPress files are unavailable', async () => {
		vi.mocked( isWordPressDirectory ).mockReturnValue( false );
		vi.spyOn( fs, 'existsSync' ).mockImplementation( ( p ) => p === testImportPath );

		const command = runCommand( testSitePath, testImportPath );
		await expect( command ).rejects.toThrow( LoggerError );
		await expect( command ).rejects.toThrow( 'Bundled WordPress files not found' );
	} );

	it( 'maps importer events to logger actions', async () => {
		const reportStartSpy = vi.spyOn( Logger.prototype, 'reportStart' );
		const reportProgressSpy = vi.spyOn( Logger.prototype, 'reportProgress' );
		const reportSuccessSpy = vi.spyOn( Logger.prototype, 'reportSuccess' );

		const importer = createImporter( async () => {
			importer.emit( ValidatorEvents.IMPORT_VALIDATION_START );
			importer.emit( ImporterEvents.IMPORT_DATABASE_START );
			importer.emit( ImporterEvents.IMPORT_DATABASE_PROGRESS, {
				processedFiles: 1,
				totalFiles: 2,
			} );
			importer.emit( ImporterEvents.IMPORT_COMPLETE, 'jetpack' );
			return importResult;
		} );
		vi.mocked( getImporter ).mockReturnValue( importer as never );

		await runCommand( testSitePath, testImportPath );

		expect( reportStartSpy ).toHaveBeenCalledWith( LoggerAction.VALIDATE, 'Validating backup…' );
		expect( reportStartSpy ).toHaveBeenCalledWith(
			LoggerAction.IMPORT_DATABASE,
			'Importing database…'
		);
		expect( reportProgressSpy ).toHaveBeenCalledWith( 'Importing database files… (1/2)' );
		expect( reportSuccessSpy ).toHaveBeenCalledWith( 'Site imported successfully' );
	} );

	it( 'preserves import error when restore steps fail', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( { pid: 1234 } as never );
		vi.mocked( getImporter ).mockReturnValue(
			createImporter( async () => {
				throw new Error( 'import failed' );
			} ) as never
		);
		vi.mocked( keepSqliteIntegrationUpdated ).mockRejectedValue( new Error( 'restart failed' ) );

		await expect( runCommand( testSitePath, testImportPath ) ).rejects.toThrow( 'import failed' );
		expect( stopWordPressServer ).toHaveBeenCalledWith( testSite.id );
	} );
} );
