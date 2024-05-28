/**
 * @jest-environment node
 */
import { shell, IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import { copySync } from 'fs-extra';
import { SQLITE_FILENAME } from '../../vendor/wp-now/src/constants';
import { downloadSqliteIntegrationPlugin } from '../../vendor/wp-now/src/download';
import { createSite, startServer } from '../ipc-handlers';
import { isEmptyDir, pathExists } from '../lib/fs-utils';
import { isSqliteInstallationOutdated, isSqlLiteInstalled } from '../lib/sqlite-versions';
import { SiteServer, createSiteWorkingDirectory } from '../site-server';

jest.mock( 'fs' );
jest.mock( 'fs-extra' );
jest.mock( '../lib/fs-utils' );
jest.mock( '../site-server' );
jest.mock( '../lib/sqlite-versions' );
jest.mock( '../../vendor/wp-now/src/download' );

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
( fs as MockedFs ).__setFileContents(
	'/path/to/app/appData/App Name/appdata-v1.json',
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

		const [ site ] = await createSite( mockIpcMainInvokeEvent, '/test', 'Test' );

		expect( site ).toEqual( {
			adminPassword: expect.any( String ),
			id: expect.any( String ),
			name: 'Test',
			path: '/test',
			running: false,
		} );
	} );

	describe( 'when the site path started as an empty directory', () => {
		it( 'should reset the directory when site creation fails', () => {
			( isEmptyDir as jest.Mock ).mockResolvedValueOnce( true );
			( pathExists as jest.Mock ).mockResolvedValueOnce( true );
			( createSiteWorkingDirectory as jest.Mock ).mockImplementation( () => {
				throw new Error( 'Intentional test error' );
			} );

			createSite( mockIpcMainInvokeEvent, '/test', 'Test' ).catch( () => {
				expect( shell.trashItem ).toHaveBeenCalledTimes( 1 );
				expect( shell.trashItem ).toHaveBeenCalledWith( '/test' );
			} );
		} );
	} );
} );

describe( 'startServer', () => {
	describe( 'when sqlite-database-integration plugin is outdated', () => {
		it( 'should update sqlite-database-integration plugin', async () => {
			const mockSitePath = 'mock-site-path';
			( isSqliteInstallationOutdated as jest.Mock ).mockResolvedValue( true );
			( isSqlLiteInstalled as jest.Mock ).mockResolvedValue( true );
			( SiteServer.get as jest.Mock ).mockReturnValue( {
				details: { path: mockSitePath },
				start: jest.fn(),
				updateSiteDetails: jest.fn(),
				updateCachedThumbnail: jest.fn( () => Promise.resolve() ),
			} );

			await startServer( mockIpcMainInvokeEvent, 'mock-site-id' );

			expect( downloadSqliteIntegrationPlugin ).toHaveBeenCalledTimes( 1 );
			expect( copySync ).toHaveBeenCalledWith(
				`/path/to/app/appData/App Name/server-files/sqlite-database-integration`,
				`${ mockSitePath }/wp-content/mu-plugins/${ SQLITE_FILENAME }`
			);
		} );
	} );

	describe( 'when sqlite-database-integration plugin is up-to-date', () => {
		it( 'should not update sqlite-database-integration plugin', async () => {
			( isSqliteInstallationOutdated as jest.Mock ).mockResolvedValue( false );
			( SiteServer.get as jest.Mock ).mockReturnValue( {
				details: { path: 'mock-site-path' },
				start: jest.fn(),
				updateSiteDetails: jest.fn(),
				updateCachedThumbnail: jest.fn( () => Promise.resolve() ),
			} );

			await startServer( mockIpcMainInvokeEvent, 'mock-site-id' );

			expect( downloadSqliteIntegrationPlugin ).not.toHaveBeenCalled();
			expect( copySync ).not.toHaveBeenCalled();
		} );
	} );
} );
