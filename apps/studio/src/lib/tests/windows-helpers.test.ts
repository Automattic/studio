/**
 * @vitest-environment node
 */
import { app, dialog, BrowserWindow } from 'electron';
import { vi } from 'vitest';
import { getMainWindow } from 'src/main-window';
import { loadUserData, updateAppdata } from 'src/storage/user-data';
import { promptWindowsSpeedUpSites } from '../windows-helpers';

vi.mock( 'src/main-window' );
vi.mock( 'src/storage/user-data' );
vi.mock( import( 'electron' ), async ( importActual ) => {
	const actual = await importActual();
	class MockBrowserWindow {}
	return {
		...actual,
		BrowserWindow: MockBrowserWindow as typeof actual.BrowserWindow,
		app: {
			...actual.app,
			getVersion: vi.fn(),
		},
		dialog: {
			...actual.dialog,
			showMessageBox: vi.fn(),
		},
	};
} );
vi.mock( '@vscode/sudo-prompt', () => ( {
	exec: vi.fn().mockImplementation( ( _command, _options, callback ) => {
		callback( null );
	} ),
} ) );

const mockLoadUserData = vi.mocked( loadUserData );
const mockUpdateAppdata = vi.mocked( updateAppdata );
const mockGetMainWindow = vi.mocked( getMainWindow );
const mockAppGetVersion = vi.mocked( app.getVersion );
const mockDialogShowMessageBox = vi.mocked( dialog.showMessageBox );

const currentVersion = '1.2.3';
const originalPlatform = process.platform;

afterEach( () => {
	Object.defineProperty( process, 'platform', {
		value: originalPlatform,
	} );
} );

describe( 'promptWindowsSpeedUpSites', () => {
	beforeEach( () => {
		mockGetMainWindow.mockResolvedValue( new BrowserWindow() as unknown as BrowserWindow );
		mockAppGetVersion.mockReturnValue( currentVersion );

		// Mock platform as Windows
		Object.defineProperty( process, 'platform', {
			value: 'win32',
		} );
	} );

	describe( 'platform checks', () => {
		it( 'should return early on non-Windows platforms', async () => {
			Object.defineProperty( process, 'platform', { value: 'darwin' } );

			mockLoadUserData.mockResolvedValue( { version: 1, siteMetadata: {} } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );

			expect( mockDialogShowMessageBox ).not.toHaveBeenCalled();
		} );

		it( 'should show prompt on Windows platform', async () => {
			mockLoadUserData.mockResolvedValue( { version: 1, siteMetadata: {} } );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );

			expect( mockDialogShowMessageBox ).toHaveBeenCalled();
		} );
	} );

	describe( 'version tracking', () => {
		it( 'should show prompt when no previous response exists', async () => {
			mockLoadUserData.mockResolvedValue( { version: 1, siteMetadata: {} } );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockDialogShowMessageBox ).toHaveBeenCalled();
		} );

		it( 'should skip prompt when user said "no" to the current version', async () => {
			mockLoadUserData.mockResolvedValue( {
				version: 1,
				siteMetadata: {},
				promptWindowsSpeedUpResult: {
					response: 'no',
					appVersion: currentVersion,
					dontAskAgain: false,
				},
			} );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockDialogShowMessageBox ).not.toHaveBeenCalled();
		} );

		it( 'should show prompt again when user said "no" to a previous version', async () => {
			mockLoadUserData.mockResolvedValue( {
				version: 1,
				siteMetadata: {},
				promptWindowsSpeedUpResult: {
					response: 'no',
					appVersion: '1.2.2', // Previous version
					dontAskAgain: false,
				},
			} );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockDialogShowMessageBox ).toHaveBeenCalled();
		} );

		it( 'should skip prompt when user said "yes" regardless of version', async () => {
			mockLoadUserData.mockResolvedValue( {
				version: 1,
				siteMetadata: {},
				promptWindowsSpeedUpResult: {
					response: 'yes',
					appVersion: '1.2.2', // Previous version
					dontAskAgain: false,
				},
			} );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockDialogShowMessageBox ).not.toHaveBeenCalled();
		} );

		it( 'should always show prompt when skipIfAlreadyPrompted is false', async () => {
			mockLoadUserData.mockResolvedValue( {
				version: 1,
				siteMetadata: {},
				promptWindowsSpeedUpResult: {
					response: 'no',
					appVersion: currentVersion,
					dontAskAgain: false,
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
				siteMetadata: {},
				// @ts-expect-error - Testing legacy string format for backward compatibility
				promptWindowsSpeedUpResult: 'yes',
			} );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockDialogShowMessageBox ).not.toHaveBeenCalled();
		} );

		it( 'should handle legacy string format "no" and show prompt', async () => {
			mockLoadUserData.mockResolvedValue( {
				siteMetadata: {},
				// @ts-expect-error - Testing legacy string format for backward compatibility
				promptWindowsSpeedUpResult: 'no',
			} );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockDialogShowMessageBox ).toHaveBeenCalled();
		} );
	} );

	describe( 'user response handling', () => {
		it( 'should save "yes" response with current app version and dontAskAgain false', async () => {
			mockLoadUserData.mockResolvedValue( { version: 1, siteMetadata: {} } );
			mockDialogShowMessageBox.mockResolvedValue( { response: 0, checkboxChecked: false } ); // First button (yes)

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );

			expect( mockUpdateAppdata ).toHaveBeenCalledWith( {
				promptWindowsSpeedUpResult: {
					response: 'yes',
					appVersion: currentVersion,
					dontAskAgain: false,
				},
			} );
		} );

		it( 'should save "no" response with current app version and dontAskAgain false', async () => {
			mockLoadUserData.mockResolvedValue( { version: 1, siteMetadata: {} } );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } ); // Second button (no)

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );

			expect( mockUpdateAppdata ).toHaveBeenCalledWith( {
				promptWindowsSpeedUpResult: {
					response: 'no',
					appVersion: currentVersion,
					dontAskAgain: false,
				},
			} );
		} );
	} );

	describe( 'dialog content', () => {
		it( 'should show correct dialog title and message', async () => {
			mockLoadUserData.mockResolvedValue( { version: 1, siteMetadata: {} } );
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

		it( 'should show checkbox when skipIfAlreadyPrompted is true', async () => {
			mockLoadUserData.mockResolvedValue( { version: 1, siteMetadata: {} } );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockDialogShowMessageBox ).toHaveBeenCalledWith(
				expect.any( BrowserWindow ),
				expect.objectContaining( {
					checkboxLabel: expect.any( String ),
				} )
			);
		} );

		it( 'should not show checkbox when skipIfAlreadyPrompted is false', async () => {
			mockLoadUserData.mockResolvedValue( { version: 1, siteMetadata: {} } );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );

			expect( mockDialogShowMessageBox ).toHaveBeenCalledWith(
				expect.any( BrowserWindow ),
				expect.not.objectContaining( {
					checkboxLabel: expect.anything(),
				} )
			);
		} );
	} );

	describe( 'dontAskAgain functionality', () => {
		it( 'should skip prompt when dontAskAgain is true regardless of version', async () => {
			mockLoadUserData.mockResolvedValue( {
				version: 1,
				siteMetadata: {},
				promptWindowsSpeedUpResult: {
					response: 'no',
					appVersion: '1.2.2', // Previous version
					dontAskAgain: true,
				},
			} );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockDialogShowMessageBox ).not.toHaveBeenCalled();
		} );

		it( 'should save dontAskAgain true when checkbox is checked with "yes" response', async () => {
			mockLoadUserData.mockResolvedValue( { version: 1, siteMetadata: {} } );
			mockDialogShowMessageBox.mockResolvedValue( { response: 0, checkboxChecked: true } ); // First button (yes) with checkbox

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockUpdateAppdata ).toHaveBeenCalledWith( {
				promptWindowsSpeedUpResult: {
					response: 'yes',
					appVersion: currentVersion,
					dontAskAgain: true,
				},
			} );
		} );

		it( 'should save dontAskAgain true when checkbox is checked with "no" response', async () => {
			mockLoadUserData.mockResolvedValue( { version: 1, siteMetadata: {} } );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: true } ); // Second button (no) with checkbox

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockUpdateAppdata ).toHaveBeenCalledWith( {
				promptWindowsSpeedUpResult: {
					response: 'no',
					appVersion: currentVersion,
					dontAskAgain: true,
				},
			} );
		} );
	} );
} );
