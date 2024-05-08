/**
 * @jest-environment node
 */
import { ipcMain } from 'electron';
import fs from 'fs';
import { withMainWindow } from '../../main-window';
import { loadUserData, saveUserData } from '../../storage/user-data';
import { setUpAuthCallbackHandler } from '../oauth';

jest.mock( 'fs' );
jest.mock( '../../main-window' );
jest.mock( '../../storage/user-data' );

const mockUserData = {
	sites: [],
};
( fs as MockedFs ).__setFileContents(
	'/path/to/app/appData/App Name/appdata-v1.json',
	JSON.stringify( mockUserData )
);

describe( 'setUpAuthCallbackHandler', () => {
	it( 'should set up auth callback handler', async () => {
		let authCallback: ( ...args: any[] ) => void = jest.fn();
		( ipcMain.on as jest.Mock ).mockImplementationOnce( ( _event, callback ) => {
			authCallback = callback;
		} );
		const mockSend = jest.fn();
		( withMainWindow as jest.Mock ).mockImplementationOnce( ( callback ) => {
			callback( {
				webContents: {
					send: mockSend,
				},
			} );
		} );
		const loadData = Promise.resolve( {} );
		( loadUserData as jest.Mock ).mockReturnValueOnce( loadData );
		const saveData = Promise.resolve( {} );
		( saveUserData as jest.Mock ).mockReturnValueOnce( saveData );

		setUpAuthCallbackHandler();
		const mockToken = { email: 'mock-email' };
		authCallback( null, { token: mockToken, error: null } );
		await ( async () => {
			await loadData;
			await saveData;
		} )();

		expect( mockSend ).toHaveBeenCalledWith( 'auth-updated', { token: mockToken } );
	} );
} );
