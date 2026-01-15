/**
 * @vitest-environment node
 */
import { shell, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import fs, { Stats } from 'fs';
import * as Sentry from '@sentry/electron/main';
import { readFile } from 'atomically';
import { vi } from 'vitest';
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

vi.mocked( SiteServer.create ).mockImplementation(
	( details ) =>
		( {
			start: vi.fn(),
			details,
			meta: {},
			updateSiteDetails: vi.fn(),
			updateCachedThumbnail: vi.fn( () => Promise.resolve() ),
			delete: vi.fn(),
			stop: vi.fn(),
			executeWpCliCommand: vi.fn(),
			hasSQLitePlugin: vi.fn(),
		} ) as Partial< SiteServer > as SiteServer
);
vi.mocked( createSiteWorkingDirectory ).mockResolvedValue( true );

const mockUserData = {
	sites: [],
};

vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( mockUserData ) ) );
// Assume the provided site path is a directory
vi.mocked( fs.promises.stat ).mockResolvedValue( {
	isDirectory: () => true,
} as Partial< Stats > as Stats );

const mockIpcMainInvokeEvent = {
	sender: { isDestroyed: vi.fn( () => false ) },
	// Double assert the type with `unknown` to simplify mocking this value
} as unknown as IpcMainInvokeEvent;

// Helper functions
const createMockSiteDetails = ( overrides = {} ): SiteDetails =>
	( {
		id: 'test-site',
		name: 'Test Site',
		path: '/test/path',
		port: 8888,
		phpVersion: '8.0',
		running: false,
		...overrides,
	} ) as SiteDetails;

const createMockSiteServer = ( overrides: Partial< SiteServer > = {} ) =>
	( {
		details: createMockSiteDetails( overrides.details ),
		meta: {},
		start: vi.fn(),
		stop: vi.fn(),
		updateSiteDetails: vi.fn(),
		executeWpCliCommand: vi
			.fn()
			.mockResolvedValue( { stdout: 'New Site Title', stderr: '', exitCode: 0 } ),
		updateCachedThumbnail: vi.fn( () => Promise.resolve() ),
		...overrides,
	} ) as Partial< SiteServer > as SiteServer;

const mockReadFileWithData = ( data: unknown ) =>
	vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( data ) ) );

afterEach( () => {
	vi.clearAllMocks();
} );

describe( 'createSite', () => {
	it( 'should create a site with generated ID when siteId is not provided', async () => {
		vi.mocked( isEmptyDir ).mockResolvedValueOnce( true );
		vi.mocked( pathExists ).mockResolvedValueOnce( true );

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
		vi.mocked( isEmptyDir ).mockResolvedValueOnce( true );
		vi.mocked( pathExists ).mockResolvedValueOnce( true );

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
			vi.mocked( isEmptyDir ).mockResolvedValueOnce( true );
			vi.mocked( pathExists ).mockResolvedValueOnce( true );
			vi.mocked( createSiteWorkingDirectory ).mockImplementation( () => {
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
		vi.mocked( keepSqliteIntegrationUpdated ).mockResolvedValue( undefined );
		vi.mocked( SiteServer.get ).mockReturnValue(
			createMockSiteServer( {
				details: createMockSiteDetails( {
					id: 'mock-site-id',
					name: 'Mock Site',
					path: mockSitePath,
				} ),
			} )
		);

		await startServer( mockIpcMainInvokeEvent, 'mock-site-id' );

		expect( keepSqliteIntegrationUpdated ).toHaveBeenCalledWith( mockSitePath );
	} );
} );

describe( 'isFullscreen', () => {
	it( 'should return false when window is not in fullscreen', async () => {
		vi.mocked( getMainWindow ).mockResolvedValue( {
			isFullScreen: () => false,
		} as Partial< BrowserWindow > as BrowserWindow );

		const result = await isFullscreen( mockIpcMainInvokeEvent );

		expect( result ).toBe( false );
	} );

	it( 'should return true when window is in fullscreen', async () => {
		vi.mocked( getMainWindow ).mockResolvedValue( {
			isFullScreen: () => true,
		} as Partial< BrowserWindow > as BrowserWindow );

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
		vi.mocked( importBackup ).mockReset();
		vi.mocked( bumpStat ).mockReset();
	} );

	it( 'should throw error if site is not found', async () => {
		vi.mocked( SiteServer.get ).mockReturnValue( null );

		await expect(
			importSite( mockIpcMainInvokeEvent, {
				id: 'non-existent-id',
				backupFile: mockBackupFile,
			} )
		).rejects.toThrow( 'Site not found.' );
	} );

	it( 'should import backup successfully and bump success stats', async () => {
		const mockSite = createMockSiteServer( {
			details: createMockSiteDetails( { phpVersion: '8.3' } ),
		} );
		vi.mocked( SiteServer.get ).mockReturnValue( mockSite );
		vi.mocked( importBackup ).mockResolvedValue( {
			extractionDirectory: '/mock/extraction',
			wpConfig: '/mock/wp-config.php',
			sqlFiles: [],
			wpContentFiles: [],
			wpContentDirectory: '/mock/wp-content',
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
		const mockSite = createMockSiteServer();
		vi.mocked( SiteServer.get ).mockReturnValue( mockSite );
		vi.mocked( importBackup ).mockRejectedValue( mockError );

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
		mockReadFileWithData( mockUserDataWithoutXdebug );
		vi.mocked( fs.existsSync ).mockReturnValue( true );

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
		mockReadFileWithData( mockUserDataWithXdebug );
		vi.mocked( fs.existsSync ).mockReturnValue( true );
		vi.mocked( SiteServer.get ).mockReturnValue(
			createMockSiteServer( {
				details: createMockSiteDetails( {
					id: 'site-2',
					name: 'Site 2',
					path: '/path/to/site-2',
					port: 8881,
					running: true,
					enableXdebug: true,
				} ),
			} )
		);

		const result = await getXdebugEnabledSite( mockIpcMainInvokeEvent );

		expect( result ).toEqual( {
			id: 'site-2',
			name: 'Site 2',
			path: '/path/to/site-2',
			port: 8881,
			phpVersion: '8.0',
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
		mockReadFileWithData( mockUserDataWithMultipleXdebug );
		vi.mocked( fs.existsSync ).mockReturnValue( true );
		vi.mocked( SiteServer.get ).mockReturnValue(
			createMockSiteServer( {
				details: createMockSiteDetails( {
					id: 'site-1',
					name: 'Site 1',
					path: '/path/to/site-1',
					port: 8880,
					enableXdebug: true,
				} ),
			} )
		);

		const result = await getXdebugEnabledSite( mockIpcMainInvokeEvent );

		expect( result ).toEqual( {
			id: 'site-1',
			name: 'Site 1',
			path: '/path/to/site-1',
			port: 8880,
			phpVersion: '8.0',
			running: false,
			enableXdebug: true,
		} );
	} );
} );
