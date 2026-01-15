/**
 * @vitest-environment node
 */
import { shell, IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import * as Sentry from '@sentry/electron/main';
import { readFile } from 'atomically';
import { vi, type Mock } from 'vitest';
import { bumpStat } from 'common/lib/bump-stat';
import { isEmptyDir, pathExists } from 'common/lib/fs-utils';
import { StatsGroup, StatsMetric } from 'common/types/stats';
import {
	createSite,
	startServer,
	isFullscreen,
	importSite,
	getXdebugEnabledSite,
} from 'src/ipc-handlers';
import { importBackup, defaultImporterOptions } from 'src/lib/import-export/import/import-manager';
import { BackupArchiveInfo } from 'src/lib/import-export/import/types';
import { keepSqliteIntegrationUpdated } from 'src/lib/sqlite-versions';
import { getMainWindow } from 'src/main-window';
import { SiteServer, createSiteWorkingDirectory } from 'src/site-server';

vi.mock( 'fs', () => ( {
	default: {
		existsSync: vi.fn().mockReturnValue( true ),
		readFile: vi.fn(),
		writeFile: vi.fn(),
		mkdirSync: vi.fn(),
		promises: {
			stat: vi.fn(),
		},
	},
	existsSync: vi.fn().mockReturnValue( true ),
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdirSync: vi.fn(),
	promises: {
		stat: vi.fn(),
	},
} ) );
vi.mock( 'fs-extra' );
vi.mock( 'common/lib/fs-utils' );
vi.mock( 'src/site-server' );
vi.mock( 'src/lib/sqlite-versions' );
vi.mock( 'src/lib/wordpress-provider', () => ( {
	downloadWordPress: vi.fn(),
	downloadWpCli: vi.fn(),
	downloadSQLiteCommand: vi.fn(),
	getWordPressProvider: vi.fn().mockReturnValue( {
		DEFAULT_PHP_VERSION: '8.3',
		DEFAULT_WORDPRESS_VERSION: 'latest',
		SQLITE_FILENAME: 'sqlite.php',
		setupWordPressFilesOnly: vi.fn().mockResolvedValue( undefined ),
	} ),
} ) );
vi.mock( 'src/main-window' );
vi.mock( 'src/lib/import-export/import/import-manager' );
vi.mock( 'common/lib/bump-stat' );

vi.mock( 'common/lib/port-finder', () => ( {
	portFinder: {
		getOpenPort: vi.fn().mockResolvedValue( 9999 ),
	},
} ) );

( SiteServer.create as Mock ).mockImplementation( ( details ) => ( {
	start: vi.fn(),
	details,
	updateSiteDetails: vi.fn(),
	updateCachedThumbnail: vi.fn( () => Promise.resolve() ),
} ) );
( createSiteWorkingDirectory as Mock ).mockResolvedValue( true );

const mockUserData = {
	sites: [],
};

( readFile as Mock ).mockResolvedValue( JSON.stringify( mockUserData ) );
// Assume the provided site path is a directory
( fs.promises.stat as Mock ).mockResolvedValue( {
	isDirectory: () => true,
} );

const mockIpcMainInvokeEvent = {
	sender: { isDestroyed: vi.fn( () => false ) },
	// Double assert the type with `unknown` to simplify mocking this value
} as unknown as IpcMainInvokeEvent;

afterEach( () => {
	vi.clearAllMocks();
} );

describe( 'createSite', () => {
	it( 'should create a site with generated ID when siteId is not provided', async () => {
		( isEmptyDir as Mock ).mockResolvedValueOnce( true );
		( pathExists as Mock ).mockResolvedValueOnce( true );

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
		( isEmptyDir as Mock ).mockResolvedValueOnce( true );
		( pathExists as Mock ).mockResolvedValueOnce( true );

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
			( isEmptyDir as Mock ).mockResolvedValueOnce( true );
			( pathExists as Mock ).mockResolvedValueOnce( true );
			( createSiteWorkingDirectory as Mock ).mockImplementation( () => {
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
		( keepSqliteIntegrationUpdated as Mock ).mockResolvedValue( undefined );
		( SiteServer.get as Mock ).mockReturnValue( {
			details: { path: mockSitePath },
			start: vi.fn(),
			updateSiteDetails: vi.fn(),
			updateCachedThumbnail: vi.fn( () => Promise.resolve() ),
		} );

		await startServer( mockIpcMainInvokeEvent, 'mock-site-id' );

		expect( keepSqliteIntegrationUpdated ).toHaveBeenCalledWith( mockSitePath );
	} );
} );

describe( 'isFullscreen', () => {
	it( 'should return false when window is not in fullscreen', async () => {
		( getMainWindow as Mock ).mockResolvedValue( {
			isFullScreen: () => false,
		} );

		const result = await isFullscreen( mockIpcMainInvokeEvent );

		expect( result ).toBe( false );
	} );

	it( 'should return true when window is in fullscreen', async () => {
		( getMainWindow as Mock ).mockResolvedValue( {
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
		( importBackup as Mock ).mockReset();
		( bumpStat as Mock ).mockReset();
	} );

	it( 'should throw error if site is not found', async () => {
		( SiteServer.get as Mock ).mockReturnValue( null );

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
			start: vi.fn(),
			stop: vi.fn(),
			updateSiteDetails: vi.fn(),
			executeWpCliCommand: vi
				.fn()
				.mockResolvedValue( { stdout: 'New Site Title', stderr: '', exitCode: 0 } ),
		};
		( SiteServer.get as Mock ).mockReturnValue( mockSite );
		( importBackup as Mock ).mockResolvedValue( {
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
			start: vi.fn(),
			stop: vi.fn(),
			executeWpCliCommand: vi
				.fn()
				.mockResolvedValue( { stdout: 'New Site Title', stderr: '', exitCode: 0 } ),
		};
		( SiteServer.get as Mock ).mockReturnValue( mockSite );
		( importBackup as Mock ).mockRejectedValue( mockError );

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

describe( 'getXdebugEnabledSite', () => {
	it( 'should return null when no site has Xdebug enabled', async () => {
		const mockUserDataWithoutXdebug = {
			sites: [
				{ id: 'site-1', name: 'Site 1', path: '/path/to/site-1', enableXdebug: false },
				{ id: 'site-2', name: 'Site 2', path: '/path/to/site-2' },
			],
		};
		( readFile as Mock ).mockResolvedValue( JSON.stringify( mockUserDataWithoutXdebug ) );
		( fs.existsSync as Mock ).mockReturnValue( true );

		const result = await getXdebugEnabledSite( mockIpcMainInvokeEvent );

		expect( result ).toBeNull();
	} );

	it( 'should return the site that has Xdebug enabled', async () => {
		const mockUserDataWithXdebug = {
			sites: [
				{ id: 'site-1', name: 'Site 1', path: '/path/to/site-1', enableXdebug: false },
				{ id: 'site-2', name: 'Site 2', path: '/path/to/site-2', enableXdebug: true },
			],
		};
		( readFile as Mock ).mockResolvedValue( JSON.stringify( mockUserDataWithXdebug ) );
		( fs.existsSync as Mock ).mockReturnValue( true );
		( SiteServer.get as Mock ).mockReturnValue( {
			details: {
				id: 'site-2',
				name: 'Site 2',
				path: '/path/to/site-2',
				running: true,
				enableXdebug: true,
			},
		} );

		const result = await getXdebugEnabledSite( mockIpcMainInvokeEvent );

		expect( result ).toEqual( {
			id: 'site-2',
			name: 'Site 2',
			path: '/path/to/site-2',
			running: true,
			enableXdebug: true,
		} );
	} );

	it( 'should return the first site when multiple have Xdebug enabled', async () => {
		const mockUserDataWithMultipleXdebug = {
			sites: [
				{ id: 'site-1', name: 'Site 1', path: '/path/to/site-1', enableXdebug: true },
				{ id: 'site-2', name: 'Site 2', path: '/path/to/site-2', enableXdebug: true },
			],
		};
		( readFile as Mock ).mockResolvedValue( JSON.stringify( mockUserDataWithMultipleXdebug ) );
		( fs.existsSync as Mock ).mockReturnValue( true );
		( SiteServer.get as Mock ).mockReturnValue( {
			details: {
				id: 'site-1',
				name: 'Site 1',
				path: '/path/to/site-1',
				running: false,
				enableXdebug: true,
			},
		} );

		const result = await getXdebugEnabledSite( mockIpcMainInvokeEvent );

		expect( result ).toEqual( {
			id: 'site-1',
			name: 'Site 1',
			path: '/path/to/site-1',
			running: false,
			enableXdebug: true,
		} );
	} );
} );
