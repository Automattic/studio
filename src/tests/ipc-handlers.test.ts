/**
 * @jest-environment node
 */
import { shell, IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import { normalize } from 'path';
import * as Sentry from '@sentry/electron/main';
import { readFile } from 'atomically';
import { bumpStat } from 'common/lib/bump-stat';
import { isEmptyDir, pathExists } from 'common/lib/fs-utils';
import { StatsGroup, StatsMetric } from 'common/types/stats';
import { createSite, startServer, isFullscreen, importSite } from 'src/ipc-handlers';
import { importBackup, defaultImporterOptions } from 'src/lib/import-export/import/import-manager';
import { BackupArchiveInfo } from 'src/lib/import-export/import/types';
import { keepSqliteIntegrationUpdated } from 'src/lib/sqlite-versions';
import { getMainWindow } from 'src/main-window';
import { SiteServer, createSiteWorkingDirectory } from 'src/site-server';

jest.mock( 'fs' );
jest.mock( 'fs-extra' );
jest.mock( 'common/lib/fs-utils' );
jest.mock( 'src/site-server' );
jest.mock( 'src/lib/sqlite-versions' );
jest.mock( 'src/lib/wordpress-provider', () => ( {
	downloadWordPress: jest.fn(),
	downloadWpCli: jest.fn(),
	downloadSQLiteCommand: jest.fn(),
	getWordPressProvider: jest.fn().mockReturnValue( {
		DEFAULT_PHP_VERSION: '8.3',
		DEFAULT_WORDPRESS_VERSION: 'latest',
		SQLITE_FILENAME: 'sqlite.php',
		setupWordPressFilesOnly: jest.fn().mockResolvedValue( undefined ),
	} ),
} ) );
jest.mock( 'src/main-window' );
jest.mock( '@sentry/electron/main' );
jest.mock( 'src/lib/import-export/import/import-manager' );
jest.mock( 'common/lib/bump-stat' );
jest.mock( 'atomically' );

jest.mock( 'common/lib/port-finder', () => ( {
	portFinder: {
		getOpenPort: jest.fn().mockResolvedValue( 9999 ),
	},
} ) );

( SiteServer.create as jest.Mock ).mockImplementation( ( details ) => ( {
	start: jest.fn(),
	details,
	updateSiteDetails: jest.fn(),
	updateCachedThumbnail: jest.fn( () => Promise.resolve() ),
} ) );
( createSiteWorkingDirectory as jest.Mock ).mockResolvedValue( true );

const mockUserData = {
	sites: [],
};
require( 'fs' ).__setFileContents(
	normalize( '/path/to/app/appData/App Name/appdata-v1.json' ),
	JSON.stringify( mockUserData )
);
( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserData ) );
// Assume the provided site path is a directory
( fs.promises.stat as jest.Mock ).mockResolvedValue( {
	isDirectory: () => true,
} );

const mockIpcMainInvokeEvent = {
	sender: { isDestroyed: jest.fn( () => false ) },
	// Double assert the type with `unknown` to simplify mocking this value
} as unknown as IpcMainInvokeEvent;

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'createSite', () => {
	it( 'should create a site with generated ID when siteId is not provided', async () => {
		( isEmptyDir as jest.Mock ).mockResolvedValueOnce( true );
		( pathExists as jest.Mock ).mockResolvedValueOnce( true );

		const userData = await createSite( mockIpcMainInvokeEvent, '/test', {
			siteName: 'Test',
			wpVersion: '6.4',
		} );

		expect( userData ).toEqual( {
			adminPassword: expect.any( String ),
			id: expect.any( String ),
			name: 'Test',
			path: '/test',
			phpVersion: '8.3',
			port: 9999,
			running: false,
			customDomain: undefined,
			enableHttps: undefined,
			isWpAutoUpdating: false,
		} );
	} );

	it( 'should create a site with provided siteId', async () => {
		( isEmptyDir as jest.Mock ).mockResolvedValueOnce( true );
		( pathExists as jest.Mock ).mockResolvedValueOnce( true );

		const customSiteId = 'custom-site-id-123';
		const userData = await createSite( mockIpcMainInvokeEvent, '/test', {
			siteName: 'Test',
			wpVersion: '6.4',
			siteId: customSiteId,
		} );

		expect( userData ).toEqual( {
			adminPassword: expect.any( String ),
			id: customSiteId,
			name: 'Test',
			path: '/test',
			phpVersion: '8.3',
			port: 9999,
			running: false,
			customDomain: undefined,
			enableHttps: undefined,
			isWpAutoUpdating: false,
		} );
	} );

	describe( 'when the site path started as an empty directory', () => {
		it( 'should reset the directory when site creation fails', () => {
			( isEmptyDir as jest.Mock ).mockResolvedValueOnce( true );
			( pathExists as jest.Mock ).mockResolvedValueOnce( true );
			( createSiteWorkingDirectory as jest.Mock ).mockImplementation( () => {
				throw new Error( 'Intentional test error' );
			} );

			createSite( mockIpcMainInvokeEvent, '/test', { siteName: 'Test', wpVersion: '6.4' } )
				.catch( () => '6.4' )
				.catch( () => {
					expect( shell.trashItem ).toHaveBeenCalledTimes( 1 );
					expect( shell.trashItem ).toHaveBeenCalledWith( '/test' );
				} );
		} );
	} );
} );

describe( 'startServer', () => {
	it( 'should keep SQLite integration up-to-date', async () => {
		const mockSitePath = 'mock-site-path';
		( keepSqliteIntegrationUpdated as jest.Mock ).mockResolvedValue( undefined );
		( SiteServer.get as jest.Mock ).mockReturnValue( {
			details: { path: mockSitePath },
			start: jest.fn(),
			updateSiteDetails: jest.fn(),
			updateCachedThumbnail: jest.fn( () => Promise.resolve() ),
		} );

		await startServer( mockIpcMainInvokeEvent, 'mock-site-id' );

		expect( keepSqliteIntegrationUpdated ).toHaveBeenCalledWith( mockSitePath );
	} );
} );

describe( 'isFullscreen', () => {
	it( 'should return false when window is not in fullscreen', async () => {
		( getMainWindow as jest.Mock ).mockResolvedValue( {
			isFullScreen: () => false,
		} );

		const result = await isFullscreen( mockIpcMainInvokeEvent );

		expect( result ).toBe( false );
	} );

	it( 'should return true when window is in fullscreen', async () => {
		( getMainWindow as jest.Mock ).mockResolvedValue( {
			isFullScreen: () => true,
		} );

		const result = await isFullscreen( mockIpcMainInvokeEvent );

		expect( result ).toBe( true );
	} );
} );

describe( 'importSite', () => {
	const mockBackupFile: BackupArchiveInfo = {
		path: '/path/to/backup.zip',
		type: 'doo',
	};

	beforeEach( () => {
		( importBackup as jest.Mock ).mockReset();
		( bumpStat as jest.Mock ).mockReset();
	} );

	it( 'should throw error if site is not found', async () => {
		( SiteServer.get as jest.Mock ).mockReturnValue( null );

		await expect(
			importSite( mockIpcMainInvokeEvent, {
				id: 'non-existent-id',
				backupFile: mockBackupFile,
			} )
		).rejects.toThrow( 'Site not found.' );
	} );

	it( 'should import backup successfully and bump success stats', async () => {
		const mockSite = {
			details: {
				id: 'test-site',
				phpVersion: '8.3',
			},
			meta: {},
			start: jest.fn(),
			stop: jest.fn(),
			updateSiteDetails: jest.fn(),
			executeWpCliCommand: jest
				.fn()
				.mockResolvedValue( { stdout: 'New Site Title', stderr: '', exitCode: 0 } ),
		};
		( SiteServer.get as jest.Mock ).mockReturnValue( mockSite );
		( importBackup as jest.Mock ).mockResolvedValue( {
			meta: {
				phpVersion: '8.3',
			},
		} );

		const result = await importSite( mockIpcMainInvokeEvent, {
			id: 'test-site',
			backupFile: mockBackupFile,
		} );

		expect( importBackup ).toHaveBeenCalledWith(
			mockBackupFile,
			mockSite.details,
			expect.any( Function ),
			defaultImporterOptions
		);
		expect( mockSite.details.phpVersion ).toBe( '8.3' );
		expect( result ).toBe( mockSite.details );

		expect( bumpStat ).toHaveBeenNthCalledWith(
			1,
			StatsGroup.STUDIO_IMPORT,
			StatsMetric.UNKNOWN_IMPORTER
		);
	} );

	it( 'should capture exception in Sentry and bump failure stats when import fails', async () => {
		const mockError = new Error( 'Import failed' );
		const mockSite = {
			details: {
				id: 'test-site',
			},
			start: jest.fn(),
			stop: jest.fn(),
			executeWpCliCommand: jest
				.fn()
				.mockResolvedValue( { stdout: 'New Site Title', stderr: '', exitCode: 0 } ),
		};
		( SiteServer.get as jest.Mock ).mockReturnValue( mockSite );
		( importBackup as jest.Mock ).mockRejectedValue( mockError );

		await expect(
			importSite( mockIpcMainInvokeEvent, {
				id: 'test-site',
				backupFile: mockBackupFile,
			} )
		).rejects.toThrow( 'Import failed' );

		expect( Sentry.captureException ).toHaveBeenCalledWith( mockError );

		// Verify failure stats were bumped
		expect( bumpStat ).toHaveBeenCalledWith( StatsGroup.STUDIO_IMPORT, StatsMetric.FAILURE );
	} );
} );
