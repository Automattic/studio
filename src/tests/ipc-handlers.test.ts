/**
 * @jest-environment node
 */
import { shell, IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import { normalize } from 'path';
import * as Sentry from '@sentry/electron/main';
import {
	createSite,
	startServer,
	isFullscreen,
	importSite,
	updateSite,
	changeWordPressVersion,
} from 'src/ipc-handlers';
import { bumpStat } from 'src/lib/bump-stats';
import {
	StatsGroup,
	StatsMetric,
	getWordPressVersionMetric,
	getPHPVersionMetric,
} from 'src/lib/bump-stats/types';
import { isEmptyDir, pathExists } from 'src/lib/fs-utils';
import { getWordPressVersionUrl } from 'src/lib/get-wordpress-version-url';
import { importBackup, defaultImporterOptions } from 'src/lib/import-export/import/import-manager';
import { BackupArchiveInfo } from 'src/lib/import-export/import/types';
import { keepSqliteIntegrationUpdated } from 'src/lib/sqlite-versions';
import { getMainWindow } from 'src/main-window';
import { SiteServer, createSiteWorkingDirectory } from 'src/site-server';

jest.mock( 'fs' );
jest.mock( 'fs-extra' );
jest.mock( 'src/lib/fs-utils' );
jest.mock( 'src/site-server' );
jest.mock( 'src/lib/sqlite-versions' );
jest.mock( 'vendor/wp-now/src/download' );
jest.mock( 'src/main-window' );
jest.mock( '@sentry/electron/main' );
jest.mock( 'src/lib/import-export/import/import-manager' );
jest.mock( 'src/lib/bump-stats' );
jest.mock( 'src/lib/get-wordpress-version-url' );

jest.mock( 'src/lib/port-finder', () => ( {
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

const mockUserData: { sites: SiteDetails[] } = {
	sites: [],
};
( fs as MockedFs ).__setFileContents(
	normalize( '/path/to/app/appData/App Name/appdata-v1.json' ),
	JSON.stringify( mockUserData )
);
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
	it( 'should create a site', async () => {
		( isEmptyDir as jest.Mock ).mockResolvedValueOnce( true );
		( pathExists as jest.Mock ).mockResolvedValueOnce( true );

		const [ site ] = await createSite( mockIpcMainInvokeEvent, '/test', 'Test', '6.4' );

		expect( site ).toEqual( {
			adminPassword: expect.any( String ),
			id: expect.any( String ),
			name: 'Test',
			path: '/test',
			phpVersion: '8.2',
			port: 9999,
			running: false,
			customDomain: undefined,
		} );

		expect( bumpStat ).toHaveBeenCalledWith(
			StatsGroup.STUDIO_SITE_VERSIONS,
			getPHPVersionMetric( '8.2' )
		);
		expect( bumpStat ).toHaveBeenCalledWith(
			StatsGroup.STUDIO_SITE_VERSIONS,
			getWordPressVersionMetric( '6.4' )
		);
	} );

	describe( 'when the site path started as an empty directory', () => {
		it( 'should reset the directory when site creation fails', () => {
			( isEmptyDir as jest.Mock ).mockResolvedValueOnce( true );
			( pathExists as jest.Mock ).mockResolvedValueOnce( true );
			( createSiteWorkingDirectory as jest.Mock ).mockImplementation( () => {
				throw new Error( 'Intentional test error' );
			} );

			createSite( mockIpcMainInvokeEvent, '/test', 'Test', '6.4' ).catch( () => {
				expect( shell.trashItem ).toHaveBeenCalledTimes( 1 );
				expect( shell.trashItem ).toHaveBeenCalledWith( '/test' );
			} );
		} );
	} );
} );

describe( 'updateSite', () => {
	it( 'should update a site and bump stats when PHP version changes', async () => {
		const existingSite = {
			id: 'test-site-id',
			name: 'Test Site',
			path: '/test',
			phpVersion: '8.0',
			port: 9999,
			running: false,
		};

		const updatedSite = {
			...existingSite,
			phpVersion: '8.2',
		};

		mockUserData.sites = [ existingSite as unknown as SiteDetails ];

		( SiteServer.get as jest.Mock ).mockReturnValue( {
			details: existingSite,
			updateSiteDetails: jest.fn(),
		} );

		await updateSite( mockIpcMainInvokeEvent, updatedSite as unknown as SiteDetails );

		// Verify that stats are bumped for PHP version change
		expect( bumpStat ).toHaveBeenCalledWith(
			StatsGroup.STUDIO_SITE_VERSIONS,
			getPHPVersionMetric( '8.2' )
		);
	} );

	it( 'should not bump stats when PHP version does not change', async () => {
		const existingSite = {
			id: 'test-site-id',
			name: 'Test Site',
			path: '/test',
			phpVersion: '8.2',
			port: 9999,
			running: false,
		};

		const updatedSite = {
			...existingSite,
			name: 'Updated Test Site',
		};

		mockUserData.sites = [ existingSite ] as unknown as SiteDetails[];

		( SiteServer.get as jest.Mock ).mockReturnValue( {
			details: existingSite,
			updateSiteDetails: jest.fn(),
		} );

		await updateSite( mockIpcMainInvokeEvent, updatedSite as unknown as SiteDetails );

		// Verify that stats are not bumped
		expect( bumpStat ).not.toHaveBeenCalled();
	} );
} );

describe( 'changeWordPressVersion', () => {
	it( 'should change WordPress version and bump stats on success', async () => {
		const siteId = 'test-site-id';
		const wpVersion = '6.4';
		const zipUrl = 'https://wordpress.org/wordpress-6.4.zip';

		( getWordPressVersionUrl as jest.Mock ).mockReturnValue( zipUrl );

		const mockServer = {
			executeWpCliCommand: jest.fn().mockResolvedValue( {
				stdout: 'WordPress updated successfully',
				stderr: '',
				exitCode: 0,
			} ),
		};

		( SiteServer.get as jest.Mock ).mockReturnValue( mockServer );
		( SiteServer.isDeleted as jest.Mock ).mockReturnValue( false );

		const result = await changeWordPressVersion( mockIpcMainInvokeEvent, { siteId, wpVersion } );

		expect( mockServer.executeWpCliCommand ).toHaveBeenCalledWith(
			`core update ${ zipUrl } --force`,
			{ skipPluginsAndThemes: true }
		);

		expect( result ).toEqual( {
			stdout: 'WordPress updated successfully',
			stderr: '',
			exitCode: 0,
		} );

		// Verify that stats are bumped for WordPress version
		expect( bumpStat ).toHaveBeenCalledWith(
			StatsGroup.STUDIO_SITE_VERSIONS,
			getWordPressVersionMetric( wpVersion )
		);
	} );

	it( 'should not bump stats when WordPress update fails', async () => {
		const siteId = 'test-site-id';
		const wpVersion = '6.4';
		const zipUrl = 'https://wordpress.org/wordpress-6.4.zip';

		( getWordPressVersionUrl as jest.Mock ).mockReturnValue( zipUrl );

		const mockServer = {
			executeWpCliCommand: jest.fn().mockResolvedValue( {
				stdout: '',
				stderr: 'Error updating WordPress',
				exitCode: 1,
			} ),
		};

		( SiteServer.get as jest.Mock ).mockReturnValue( mockServer );
		( SiteServer.isDeleted as jest.Mock ).mockReturnValue( false );

		const result = await changeWordPressVersion( mockIpcMainInvokeEvent, { siteId, wpVersion } );

		expect( result ).toEqual( {
			stdout: '',
			stderr: 'Error updating WordPress',
			exitCode: 1,
		} );

		// Verify that stats are not bumped
		expect( bumpStat ).not.toHaveBeenCalled();
	} );

	it( 'should return error when site is deleted', async () => {
		const siteId = 'deleted-site-id';
		const wpVersion = '6.4';

		( SiteServer.isDeleted as jest.Mock ).mockReturnValue( true );

		const result = await changeWordPressVersion( mockIpcMainInvokeEvent, { siteId, wpVersion } );

		expect( result ).toEqual( {
			stdout: '',
			stderr: `Cannot change WordPress version on deleted site ${ siteId }`,
			exitCode: 1,
		} );

		// Verify that stats are not bumped
		expect( bumpStat ).not.toHaveBeenCalled();
	} );

	it( 'should throw error when site is not found', async () => {
		const siteId = 'non-existent-site-id';
		const wpVersion = '6.4';

		( SiteServer.isDeleted as jest.Mock ).mockReturnValue( false );
		( SiteServer.get as jest.Mock ).mockReturnValue( null );

		await expect(
			changeWordPressVersion( mockIpcMainInvokeEvent, { siteId, wpVersion } )
		).rejects.toThrow( 'Site not found.' );

		// Verify that stats are not bumped
		expect( bumpStat ).not.toHaveBeenCalled();
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
				phpVersion: '8.0',
			},
			updateSiteDetails: jest.fn(),
		};
		( SiteServer.get as jest.Mock ).mockReturnValue( mockSite );
		( importBackup as jest.Mock ).mockResolvedValue( {
			meta: {
				phpVersion: '8.2',
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
		expect( mockSite.details.phpVersion ).toBe( '8.2' );
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
