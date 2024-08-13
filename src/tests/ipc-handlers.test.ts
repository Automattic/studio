/**
 * @jest-environment node
 */
import { shell, IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import { createSite, startServer } from '../ipc-handlers';
import { isEmptyDir, pathExists } from '../lib/fs-utils';
import { keepSqliteIntegrationUpdated } from '../lib/sqlite-versions';
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
			phpVersion: '8.1',
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
