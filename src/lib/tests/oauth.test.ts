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
		( ipcMain.on as jest.Mock ).mockImplementationOnce( ( event, callback ) => {
			if ( event === 'auth-callback' ) {
				authCallback = callback;
			}
		} );
		const mockSend = jest.fn();
		( withMainWindow as jest.Mock ).mockImplementationOnce( ( callback ) => {
			callback( {
				webContents: {
					send: mockSend,
				},
			} );
		} );
		( loadUserData as jest.Mock ).mockResolvedValueOnce( {} );
		( saveUserData as jest.Mock ).mockResolvedValueOnce( {} );

		setUpAuthCallbackHandler();
		const mockToken = { email: 'mock-email' };
		authCallback( null, { token: mockToken, error: null } );
		// Wait for the mocked promises to resolve
		await new Promise( process.nextTick );

		expect( mockSend ).toHaveBeenCalledWith( 'auth-updated', { token: mockToken } );
	} );
} );
