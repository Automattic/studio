/**
 * @vitest-environment node
 */
import fs from 'fs';
import { normalize } from 'path';
import * as Sentry from '@sentry/electron/main';
import { readFile } from 'atomically';
import { bumpStat } from 'common/lib/bump-stat';
import { StatsGroup, StatsMetric } from 'common/types/stats';
import { createSite, isFullscreen, importSite, getXdebugEnabledSite } from 'src/ipc-handlers';
import { importBackup, defaultImporterOptions } from 'src/lib/import-export/import/import-manager';
import { BackupArchiveInfo } from 'src/lib/import-export/import/types';
import { getMainWindow } from 'src/main-window';
import { SiteServer } from 'src/site-server';
import electron from 'electron';
import type { IpcMainInvokeEvent } from 'electron';

<<<<<<< HEAD
const { app, BrowserWindow } = electron;
=======
jest.mock( 'fs' );
jest.mock( 'fs-extra' );
jest.mock( 'common/lib/fs-utils' );
jest.mock( 'src/site-server' );
jest.mock( 'src/lib/wordpress-setup', () => ( {
	setupWordPressFilesOnly: jest.fn().mockResolvedValue( undefined ),
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
>>>>>>> 3d31ad1e00b9363cc8c1fe93a3292145439494b5

const mockSiteDetails: StoppedSiteDetails = {
	id: 'mock-cli-site-id',
	name: 'Test',
	path: '/test',
	port: 9999,
	phpVersion: '8.3',
	running: false,
	adminPassword: 'mock-password',
	isWpAutoUpdating: false,
	customDomain: undefined,
	enableHttps: undefined,
};

vi.mocked( SiteServer.create ).mockResolvedValue( {
	server: {
		start: vi.fn(),
		details: mockSiteDetails,
		updateSiteDetails: vi.fn(),
		updateCachedThumbnail: vi.fn( () => Promise.resolve() ),
	},
	details: mockSiteDetails,
} );

vi.mocked( SiteServer.register ).mockImplementation( ( details ) => ( {
	start: vi.fn(),
	details,
	updateSiteDetails: vi.fn(),
	updateCachedThumbnail: vi.fn( () => Promise.resolve() ),
} ) );

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
const createMockSiteServer = ( overrides: Partial< SiteServer > = {} ): SiteServer =>
	( {
		details: {
			id: 'test-site',
			name: 'Test Site',
			path: '/test/path',
			port: 8888,
			phpVersion: '8.3',
			running: false,
			...( overrides.details || {} ),
		},
		meta: {},
		server: {} as any,
		hasOngoingOperation: false,
		start: vi.fn(),
		stop: vi.fn(),
		delete: vi.fn(),
		updateSiteDetails: vi.fn(),
		updateCachedThumbnail: vi.fn( () => Promise.resolve() ),
		executeWpCliCommand: vi
			.fn()
			.mockResolvedValue( { stdout: 'New Site Title', stderr: '', exitCode: 0 } ),
		...overrides,
	} ) as Partial< SiteServer > as SiteServer;

const mockReadFileWithData = ( data: unknown ) =>
	vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( data ) ) );

afterEach( () => {
	vi.clearAllMocks();
} );

describe( 'createSite', () => {
	it( 'should delegate to CLI and return site details', async () => {
		const userData = await createSite( mockIpcMainInvokeEvent, '/test', {
			siteName: 'Test',
			wpVersion: '6.4',
		} );

		expect( userData ).toEqual( {
			adminPassword: 'mock-password',
			id: 'mock-cli-site-id',
			name: 'Test',
			path: '/test',
			phpVersion: '8.3',
			port: 9999,
			running: false,
			customDomain: undefined,
			enableHttps: undefined,
			isWpAutoUpdating: false,
		} );

		expect( SiteServer.create ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/test',
				name: 'Test',
				wpVersion: '6.4',
			} ),
			expect.any( Object )
		);
	} );
} );

describe( 'isFullscreen', () => {
	it( 'should return false when window is not in fullscreen', async () => {
		vi.mocked( getMainWindow ).mockResolvedValue( {
			isFullScreen: () => false,
		} );

		const result = await isFullscreen( mockIpcMainInvokeEvent );

		expect( result ).toBe( false );
	} );

	it( 'should return true when window is in fullscreen', async () => {
		vi.mocked( getMainWindow ).mockResolvedValue( {
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
			details: { id: 'test-site', phpVersion: '8.3' },
		} );
		vi.mocked( SiteServer.get ).mockReturnValue( mockSite );
		vi.mocked( importBackup ).mockResolvedValue( {
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
				details: {
					id: 'site-2',
					name: 'Site 2',
					path: '/path/to/site-2',
					running: true,
					enableXdebug: true,
				},
			} )
		);

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
		mockReadFileWithData( mockUserDataWithMultipleXdebug );
		vi.mocked( fs.existsSync ).mockReturnValue( true );
		vi.mocked( SiteServer.get ).mockReturnValue(
			createMockSiteServer( {
				details: {
					id: 'site-1',
					name: 'Site 1',
					path: '/path/to/site-1',
					running: false,
					enableXdebug: true,
				},
			} )
		);

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
