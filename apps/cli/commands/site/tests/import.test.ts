import fs from 'fs';
import path from 'path';
import { isWordPressDirectory, recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { vi } from 'vitest';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { ImporterEvents, ValidatorEvents } from 'cli/lib/import-export/import/events';
import {
	DEFAULT_IMPORTER_OPTIONS,
	importBackup,
} from 'cli/lib/import-export/import/import-manager';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { runCommand } from '../import';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/cli-config/sites', () => ( {
	clearSiteLatestCliPid: vi.fn(),
	getSiteByFolder: vi.fn(),
	getSiteUrl: vi.fn(),
} ) );
vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'cli/lib/sqlite-integration', () => ( {
	keepSqliteIntegrationUpdated: vi.fn(),
} ) );
vi.mock( 'cli/lib/wordpress-server-manager', () => ( {
	isServerRunning: vi.fn(),
	stopWordPressServer: vi.fn(),
} ) );
vi.mock( 'cli/lib/import-export/import/import-manager', () => ( {
	DEFAULT_IMPORTER_OPTIONS: [],
	importBackup: vi.fn(),
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

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( connectToDaemon ).mockResolvedValue( undefined );
		vi.mocked( disconnectFromDaemon ).mockResolvedValue( undefined );
		vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
		vi.mocked( isServerRunning ).mockResolvedValue( undefined );
		vi.mocked( stopWordPressServer ).mockResolvedValue( undefined );
		vi.mocked( keepSqliteIntegrationUpdated ).mockResolvedValue( false );
		vi.mocked( isWordPressDirectory ).mockReturnValue( true );
		vi.mocked( getServerFilesPath ).mockReturnValue( '/server-files' );
		vi.mocked( recursiveCopyDirectory ).mockResolvedValue( undefined );
		vi.spyOn( fs, 'existsSync' ).mockImplementation( ( p ) => p === testImportPath );
		vi.mocked( importBackup ).mockResolvedValue( {
			extractionDirectory: '/tmp/extracted',
			sqlFiles: [],
			wpContentFiles: [],
			wpContentDirectory: '/tmp/extracted/wp-content',
			wpConfig: '/tmp/extracted/wp-config.php',
			importerType: 'LocalImporter',
		} );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'loads site and imports backup', async () => {
		await runCommand( testSitePath, testImportPath );

		expect( connectToDaemon ).toHaveBeenCalled();
		expect( getSiteByFolder ).toHaveBeenCalledWith( testSitePath );
		expect( importBackup ).toHaveBeenCalledWith(
			{
				path: testImportPath,
				type: 'application/zip',
			},
			testSite,
			expect.any( Function ),
			DEFAULT_IMPORTER_OPTIONS
		);
		expect( disconnectFromDaemon ).toHaveBeenCalled();
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

		vi.mocked( importBackup ).mockImplementation( async ( _backupFile, _site, onEvent ) => {
			onEvent( {
				event: ValidatorEvents.IMPORT_VALIDATION_START,
				data: undefined,
			} );
			onEvent( {
				event: ImporterEvents.IMPORT_DATABASE_START,
				data: undefined,
			} );
			onEvent( {
				event: ImporterEvents.IMPORT_DATABASE_PROGRESS,
				data: { processedFiles: 1, totalFiles: 2 },
			} );
			onEvent( {
				event: ImporterEvents.IMPORT_COMPLETE,
				data: undefined,
			} );
			return {
				extractionDirectory: '/tmp/extracted',
				sqlFiles: [],
				wpContentFiles: [],
				wpContentDirectory: '/tmp/extracted/wp-content',
				wpConfig: '/tmp/extracted/wp-config.php',
				importerType: 'LocalImporter',
			};
		} );

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
		vi.mocked( importBackup ).mockRejectedValue( new Error( 'import failed' ) );
		vi.mocked( keepSqliteIntegrationUpdated ).mockRejectedValue( new Error( 'restart failed' ) );

		await expect( runCommand( testSitePath, testImportPath ) ).rejects.toThrow( 'import failed' );
		expect( stopWordPressServer ).toHaveBeenCalledWith( testSite.id );
	} );
} );
