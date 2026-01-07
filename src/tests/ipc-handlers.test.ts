/**
 * @jest-environment node
 */
import { IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import { normalize } from 'path';
import * as Sentry from '@sentry/electron/main';
import { readFile } from 'atomically';
import { bumpStat } from 'common/lib/bump-stat';
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
import { getMainWindow } from 'src/main-window';
import { SiteServer } from 'src/site-server';

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

( SiteServer.create as jest.Mock ).mockResolvedValue( {
	server: {
		start: jest.fn(),
		details: mockSiteDetails,
		updateSiteDetails: jest.fn(),
		updateCachedThumbnail: jest.fn( () => Promise.resolve() ),
	},
	details: mockSiteDetails,
} );

( SiteServer.register as jest.Mock ).mockImplementation( ( details ) => ( {
	start: jest.fn(),
	details,
	updateSiteDetails: jest.fn(),
	updateCachedThumbnail: jest.fn( () => Promise.resolve() ),
} ) );

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

describe( 'getXdebugEnabledSite', () => {
	it( 'should return null when no site has Xdebug enabled', async () => {
		const mockUserDataWithoutXdebug = {
			sites: [
				{ id: 'site-1', name: 'Site 1', path: '/path/to/site-1', enableXdebug: false },
				{ id: 'site-2', name: 'Site 2', path: '/path/to/site-2' },
			],
		};
		( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserDataWithoutXdebug ) );
		( fs.existsSync as jest.Mock ).mockReturnValue( true );

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
		( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserDataWithXdebug ) );
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( SiteServer.get as jest.Mock ).mockReturnValue( {
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
			autoStart: false,
			id: 'site-2',
			name: 'Site 2',
			path: '/path/to/site-2',
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
		( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserDataWithMultipleXdebug ) );
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( SiteServer.get as jest.Mock ).mockReturnValue( {
			details: {
				autoStart: false,
				id: 'site-1',
				name: 'Site 1',
				path: '/path/to/site-1',
				phpVersion: '8.0',
				running: false,
				enableXdebug: true,
			},
		} );

		const result = await getXdebugEnabledSite( mockIpcMainInvokeEvent );

		expect( result ).toEqual( {
			autoStart: false,
			id: 'site-1',
			name: 'Site 1',
			path: '/path/to/site-1',
			phpVersion: '8.0',
			running: false,
			enableXdebug: true,
		} );
	} );
} );
