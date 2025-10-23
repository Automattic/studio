/**
 * @jest-environment node
 */
import { app, dialog, BrowserWindow } from 'electron';
import { getMainWindow } from 'src/main-window';
import { loadUserData, updateAppdata } from 'src/storage/user-data';
import { promptWindowsSpeedUpSites } from '../windows-helpers';

jest.mock( 'electron' );
jest.mock( 'src/main-window' );
jest.mock( 'src/storage/user-data' );
jest.mock( '@vscode/sudo-prompt', () => ( {
	exec: jest.fn( ( _command, _options, callback ) => {
		callback( null );
	} ),
} ) );

const mockLoadUserData = loadUserData as jest.MockedFunction< typeof loadUserData >;
const mockUpdateAppdata = updateAppdata as jest.MockedFunction< typeof updateAppdata >;
const mockGetMainWindow = getMainWindow as jest.MockedFunction< typeof getMainWindow >;
const mockAppGetVersion = app.getVersion as jest.MockedFunction< typeof app.getVersion >;
const mockDialogShowMessageBox = dialog.showMessageBox as jest.MockedFunction<
	typeof dialog.showMessageBox
>;

const currentVersion = '1.2.3';
const originalPlatform = process.platform;

afterEach( () => {
	jest.clearAllMocks();
	Object.defineProperty( process, 'platform', {
		value: originalPlatform,
	} );
} );

describe( 'promptWindowsSpeedUpSites', () => {
	beforeEach( () => {
		mockGetMainWindow.mockResolvedValue( new BrowserWindow() );
		mockAppGetVersion.mockReturnValue( currentVersion );

		// Mock platform as Windows
		Object.defineProperty( process, 'platform', {
			value: 'win32',
		} );
	} );

	describe( 'platform checks', () => {
		it( 'should return early on non-Windows platforms', async () => {
			Object.defineProperty( process, 'platform', { value: 'darwin' } );

			mockLoadUserData.mockResolvedValue( { sites: [], snapshots: [] } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );

			expect( mockDialogShowMessageBox ).not.toHaveBeenCalled();
		} );

		it( 'should show prompt on Windows platform', async () => {
			mockLoadUserData.mockResolvedValue( { sites: [], snapshots: [] } );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );

			expect( mockDialogShowMessageBox ).toHaveBeenCalled();
		} );
	} );

	describe( 'version tracking', () => {
		it( 'should show prompt when no previous response exists', async () => {
			mockLoadUserData.mockResolvedValue( { sites: [], snapshots: [] } );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockDialogShowMessageBox ).toHaveBeenCalled();
		} );

		it( 'should skip prompt when user said "no" to the current version', async () => {
			mockLoadUserData.mockResolvedValue( {
				sites: [],
				snapshots: [],
				promptWindowsSpeedUpResult: {
					response: 'no',
					appVersion: currentVersion,
				},
			} );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockDialogShowMessageBox ).not.toHaveBeenCalled();
		} );

		it( 'should show prompt again when user said "no" to a previous version', async () => {
			mockLoadUserData.mockResolvedValue( {
				sites: [],
				snapshots: [],
				promptWindowsSpeedUpResult: {
					response: 'no',
					appVersion: '1.2.2', // Previous version
				},
			} );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockDialogShowMessageBox ).toHaveBeenCalled();
		} );

		it( 'should skip prompt when user said "yes" regardless of version', async () => {
			mockLoadUserData.mockResolvedValue( {
				sites: [],
				snapshots: [],
				promptWindowsSpeedUpResult: {
					response: 'yes',
					appVersion: '1.2.2', // Previous version
				},
			} );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockDialogShowMessageBox ).not.toHaveBeenCalled();
		} );

		it( 'should always show prompt when skipIfAlreadyPrompted is false', async () => {
			mockLoadUserData.mockResolvedValue( {
				sites: [],
				snapshots: [],
				promptWindowsSpeedUpResult: {
					response: 'no',
					appVersion: currentVersion,
				},
			} );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );

			expect( mockDialogShowMessageBox ).toHaveBeenCalled();
		} );
	} );

	describe( 'legacy format handling', () => {
		it( 'should handle legacy string format "yes" and skip prompt', async () => {
			mockLoadUserData.mockResolvedValue( {
				sites: [],
				snapshots: [],
				// @ts-expect-error - Testing legacy string format for backward compatibility
				promptWindowsSpeedUpResult: 'yes',
			} );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockDialogShowMessageBox ).not.toHaveBeenCalled();
		} );

		it( 'should handle legacy string format "no" and show prompt', async () => {
			mockLoadUserData.mockResolvedValue( {
				sites: [],
				snapshots: [],
				// @ts-expect-error - Testing legacy string format for backward compatibility
				promptWindowsSpeedUpResult: 'no',
			} );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockDialogShowMessageBox ).toHaveBeenCalled();
		} );
	} );

	describe( 'user response handling', () => {
		it( 'should save "yes" response with current app version', async () => {
			mockLoadUserData.mockResolvedValue( { sites: [], snapshots: [] } );
			mockDialogShowMessageBox.mockResolvedValue( { response: 0, checkboxChecked: false } ); // First button (yes)

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );

			expect( mockUpdateAppdata ).toHaveBeenCalledWith( {
				promptWindowsSpeedUpResult: {
					response: 'yes',
					appVersion: currentVersion,
				},
			} );
		} );

		it( 'should save "no" response with current app version', async () => {
			mockLoadUserData.mockResolvedValue( { sites: [], snapshots: [] } );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } ); // Second button (no)

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );

			expect( mockUpdateAppdata ).toHaveBeenCalledWith( {
				promptWindowsSpeedUpResult: {
					response: 'no',
					appVersion: currentVersion,
				},
			} );
		} );
	} );

	describe( 'dialog content', () => {
		it( 'should show correct dialog title and message', async () => {
			mockLoadUserData.mockResolvedValue( { sites: [], snapshots: [] } );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );

			expect( mockDialogShowMessageBox ).toHaveBeenCalledWith(
				expect.any( BrowserWindow ),
				expect.objectContaining( {
					type: 'question',
					title: expect.any( String ),
					message: expect.stringContaining( 'Microsoft Defender' ),
					buttons: expect.arrayContaining( [ expect.any( String ), expect.any( String ) ] ),
				} )
			);
		} );
	} );
} );
