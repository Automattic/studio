/**
 * @jest-environment node
 */
import { shell, IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import { createSite } from '../ipc-handlers';
import { isEmptyDir, pathExists } from '../lib/fs-utils';
import { SiteServer, createSiteWorkingDirectory } from '../site-server';

jest.mock( 'fs' );
jest.mock( '../lib/fs-utils' );
jest.mock( '../site-server' );

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

describe( 'createSite', () => {
	it( 'should create a site', async () => {
		( isEmptyDir as jest.Mock ).mockResolvedValue( true );
		( pathExists as jest.Mock ).mockResolvedValue( true );
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
			( isEmptyDir as jest.Mock ).mockResolvedValue( true );
			( pathExists as jest.Mock ).mockResolvedValue( true );
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
