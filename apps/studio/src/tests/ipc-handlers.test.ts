/**
 * @vitest-environment node
 */
import { IpcMainInvokeEvent } from 'electron';
import { normalize } from 'path';
import * as Sentry from '@sentry/electron/main';
import { readFile } from 'atomically';
import { vol } from 'memfs';
import { vi } from 'vitest';
import {
	createSite,
	isFullscreen,
	importSite,
	getXdebugEnabledSite,
	loadThemeDetails,
} from 'src/ipc-handlers';
import { bumpStat, StatsGroup, StatsMetric } from 'src/lib/bump-stats';
import { captureSiteThumbnail } from 'src/lib/capture-site-thumbnail';
import { importBackup, defaultImporterOptions } from 'src/lib/import-export/import/import-manager';
import { BackupArchiveInfo } from 'src/lib/import-export/import/types';
import { getMainWindow } from 'src/main-window';
import { SiteServer } from 'src/site-server';

vi.mock( 'fs' );
vi.mock( 'fs-extra' );
vi.mock( '@studio/common/lib/fs-utils' );
vi.mock( '@sentry/electron/main', () => ( {
	captureException: vi.fn(),
	captureMessage: vi.fn(),
} ) );
vi.mock( 'src/site-server' );
vi.mock( 'src/lib/wordpress-setup', () => ( {
	setupWordPressFilesOnly: vi.fn().mockResolvedValue( undefined ),
} ) );
vi.mock( 'src/main-window' );
vi.mock( 'src/lib/import-export/import/import-manager' );
vi.mock( import( 'src/lib/bump-stats' ), async ( importOriginal ) => {
	const actual = await importOriginal();
	return {
		...actual,
		bumpStat: vi.fn(),
		bumpAggregatedUniqueStat: vi.fn().mockResolvedValue( undefined ),
	};
} );
vi.mock( 'atomically' );
vi.mock( 'src/lib/get-image-data', () => ( {
	getImageData: vi.fn().mockResolvedValue( 'data:image/png;base64,mock' ),
} ) );
vi.mock( 'src/lib/capture-site-thumbnail', () => ( {
	captureSiteThumbnail: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/port-finder', () => ( {
	portFinder: {
		getOpenPort: vi.fn().mockResolvedValue( 9999 ),
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

vi.mocked( SiteServer.create ).mockResolvedValue( {
	server: {
		start: vi.fn(),
		details: mockSiteDetails,
		updateSiteDetails: vi.fn(),
		updateCachedThumbnail: vi.fn().mockResolvedValue( undefined ),
	} as unknown as SiteServer,
	details: mockSiteDetails,
} );

vi.mocked( SiteServer.register, { partial: true } ).mockImplementation( ( details ) => ( {
	start: vi.fn(),
	details,
	updateSiteDetails: vi.fn(),
	updateCachedThumbnail: vi.fn().mockResolvedValue( undefined ),
} ) );

const mockUserData = {
	sites: [],
};

beforeEach( () => {
	vol.reset();
	vol.fromJSON( {
		[ normalize( '/path/to/app/appData/App Name/appdata-v1.json' ) ]:
			JSON.stringify( mockUserData ),
	} );
} );

vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( mockUserData ) ) );

const mockIpcMainInvokeEvent = {
	sender: { isDestroyed: vi.fn().mockReturnValue( false ) },
	// Double assert the type with `unknown` to simplify mocking this value
} as unknown as IpcMainInvokeEvent;

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
		vi.mocked( getMainWindow, { partial: true } ).mockResolvedValue( {
			isFullScreen: () => false,
		} );

		const result = await isFullscreen( mockIpcMainInvokeEvent );

		expect( result ).toBe( false );
	} );

	it( 'should return true when window is in fullscreen', async () => {
		vi.mocked( getMainWindow, { partial: true } ).mockResolvedValue( {
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
		vi.mocked( SiteServer.get ).mockReturnValue( undefined );

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
				name: 'Test',
				path: '/test',
				port: 9999,
				phpVersion: '8.3',
				running: false,
			},
			meta: {},
			start: vi.fn(),
			stop: vi.fn(),
			updateSiteDetails: vi.fn(),
			executeWpCliCommand: vi
				.fn()
				.mockResolvedValue( { stdout: 'New Site Title', stderr: '', exitCode: 0 } ),
		};
		vi.mocked( SiteServer.get, { partial: true } ).mockReturnValue(
			mockSite as unknown as Partial< SiteServer >
		);
		vi.mocked( importBackup, { partial: true } ).mockResolvedValue( {
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
				name: 'Test',
				path: '/test',
				port: 9999,
				phpVersion: '8.3',
				running: false,
			},
			meta: {},
			start: vi.fn(),
			stop: vi.fn(),
			updateSiteDetails: vi.fn(),
			executeWpCliCommand: vi
				.fn()
				.mockResolvedValue( { stdout: 'New Site Title', stderr: '', exitCode: 0 } ),
		};
		vi.mocked( SiteServer.get, { partial: true } ).mockReturnValue(
			mockSite as unknown as Partial< SiteServer >
		);
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
		vi.mocked( SiteServer.getAllDetails ).mockReturnValue( [
			{
				id: 'site-1',
				name: 'Site 1',
				path: '/path/to/site-1',
				enableXdebug: false,
				running: false,
				phpVersion: '8.3',
				port: 9999,
			},
			{
				id: 'site-2',
				name: 'Site 2',
				path: '/path/to/site-2',
				running: false,
				phpVersion: '8.3',
				port: 9998,
			},
		] as SiteDetails[] );

		const result = await getXdebugEnabledSite( mockIpcMainInvokeEvent );

		expect( result ).toBeNull();
	} );

	it( 'should return the site that has Xdebug enabled', async () => {
		vi.mocked( SiteServer.getAllDetails ).mockReturnValue( [
			{
				id: 'site-1',
				name: 'Site 1',
				path: '/path/to/site-1',
				enableXdebug: false,
				running: false,
				phpVersion: '8.3',
				port: 9999,
			},
			{
				id: 'site-2',
				name: 'Site 2',
				path: '/path/to/site-2',
				enableXdebug: true,
				running: true,
				phpVersion: '8.3',
				port: 9999,
				url: 'https://site-2.test',
			},
		] as SiteDetails[] );

		const result = await getXdebugEnabledSite( mockIpcMainInvokeEvent );

		expect( result ).toEqual( {
			id: 'site-2',
			name: 'Site 2',
			path: '/path/to/site-2',
			running: true,
			enableXdebug: true,
			phpVersion: '8.3',
			port: 9999,
			url: 'https://site-2.test',
		} );
	} );

	it( 'should return the first site when multiple have Xdebug enabled', async () => {
		vi.mocked( SiteServer.getAllDetails ).mockReturnValue( [
			{
				id: 'site-1',
				name: 'Site 1',
				path: '/path/to/site-1',
				enableXdebug: true,
				running: false,
				phpVersion: '8.3',
				port: 9999,
			},
			{
				id: 'site-2',
				name: 'Site 2',
				path: '/path/to/site-2',
				enableXdebug: true,
				running: true,
				phpVersion: '8.3',
				port: 9998,
			},
		] as SiteDetails[] );

		const result = await getXdebugEnabledSite( mockIpcMainInvokeEvent );

		expect( result ).toEqual( {
			id: 'site-1',
			name: 'Site 1',
			path: '/path/to/site-1',
			running: false,
			enableXdebug: true,
			phpVersion: '8.3',
			port: 9999,
		} );
	} );
} );

describe( 'loadThemeDetails', () => {
	it( 'should capture thumbnail but not persist theme details when theme has not changed', async () => {
		const themeDetails = { name: 'Twenty Twenty-Four', path: '/themes/twentytwentyfour' };
		const mockServer = {
			details: {
				id: 'test-site-id',
				running: true,
				themeDetails,
			},
			getThemeDetails: vi.fn().mockResolvedValue( themeDetails ),
			persistThemeDetails: vi.fn().mockResolvedValue( undefined ),
		};
		vi.mocked( SiteServer.get ).mockReturnValue( mockServer as unknown as SiteServer );

		await loadThemeDetails( mockIpcMainInvokeEvent, 'test-site-id' );

		expect( mockServer.persistThemeDetails ).not.toHaveBeenCalled();
		expect( captureSiteThumbnail ).toHaveBeenCalledWith( 'test-site-id' );
	} );

	it( 'should persist theme details and capture thumbnail when theme has changed', async () => {
		const oldThemeDetails = { name: 'Twenty Twenty-Four', path: '/themes/twentytwentyfour' };
		const newThemeDetails = { name: 'Twenty Twenty-Five', path: '/themes/twentytwentyfive' };
		const mockServer = {
			details: {
				id: 'test-site-id',
				running: true,
				themeDetails: oldThemeDetails,
			},
			getThemeDetails: vi.fn().mockResolvedValue( newThemeDetails ),
			persistThemeDetails: vi.fn().mockResolvedValue( undefined ),
		};
		vi.mocked( SiteServer.get ).mockReturnValue( mockServer as unknown as SiteServer );

		await loadThemeDetails( mockIpcMainInvokeEvent, 'test-site-id' );

		expect( mockServer.persistThemeDetails ).toHaveBeenCalled();
		expect( captureSiteThumbnail ).toHaveBeenCalledWith( 'test-site-id' );
	} );
} );
