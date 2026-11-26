/**
 * @vitest-environment node
 */
import { app, dialog, BrowserWindow } from 'electron';
import { vi } from 'vitest';
import { getMainWindow } from 'src/main-window';
import { readDesktopState, updateDesktopState } from 'src/storage/desktop-state';
import { promptWindowsSpeedUpSites } from '../windows-helpers';

vi.mock( 'src/main-window' );
vi.mock( 'src/storage/desktop-state' );
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

const mockReadDesktopState = vi.mocked( readDesktopState );
const mockUpdateDesktopState = vi.mocked( updateDesktopState );
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

			mockReadDesktopState.mockResolvedValue( {} );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );

			expect( mockDialogShowMessageBox ).not.toHaveBeenCalled();
		} );

		it( 'should show prompt on Windows platform', async () => {
			mockReadDesktopState.mockResolvedValue( {} );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );

			expect( mockDialogShowMessageBox ).toHaveBeenCalled();
		} );
	} );

	describe( 'version tracking', () => {
		it( 'should show prompt when no previous response exists', async () => {
			mockReadDesktopState.mockResolvedValue( {} );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockDialogShowMessageBox ).toHaveBeenCalled();
		} );

		it( 'should skip prompt when user said "no" to the current version', async () => {
			mockReadDesktopState.mockResolvedValue( {
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
			mockReadDesktopState.mockResolvedValue( {
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
			mockReadDesktopState.mockResolvedValue( {
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
			mockReadDesktopState.mockResolvedValue( {
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

	describe( 'user response handling', () => {
		it( 'should save "yes" response with current app version and dontAskAgain false', async () => {
			mockReadDesktopState.mockResolvedValue( {} );
			mockDialogShowMessageBox.mockResolvedValue( { response: 0, checkboxChecked: false } ); // First button (yes)

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );

			expect( mockUpdateDesktopState ).toHaveBeenCalledWith( {
				promptWindowsSpeedUpResult: {
					response: 'yes',
					appVersion: currentVersion,
					dontAskAgain: false,
				},
			} );
		} );

		it( 'should save "no" response with current app version and dontAskAgain false', async () => {
			mockReadDesktopState.mockResolvedValue( {} );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } ); // Second button (no)

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );

			expect( mockUpdateDesktopState ).toHaveBeenCalledWith( {
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
			mockReadDesktopState.mockResolvedValue( {} );
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
			mockReadDesktopState.mockResolvedValue( {} );
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
			mockReadDesktopState.mockResolvedValue( {} );
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
			mockReadDesktopState.mockResolvedValue( {
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
			mockReadDesktopState.mockResolvedValue( {} );
			mockDialogShowMessageBox.mockResolvedValue( { response: 0, checkboxChecked: true } ); // First button (yes) with checkbox

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockUpdateDesktopState ).toHaveBeenCalledWith( {
				promptWindowsSpeedUpResult: {
					response: 'yes',
					appVersion: currentVersion,
					dontAskAgain: true,
				},
			} );
		} );

		it( 'should save dontAskAgain true when checkbox is checked with "no" response', async () => {
			mockReadDesktopState.mockResolvedValue( {} );
			mockDialogShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: true } ); // Second button (no) with checkbox

			await promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );

			expect( mockUpdateDesktopState ).toHaveBeenCalledWith( {
				promptWindowsSpeedUpResult: {
					response: 'no',
					appVersion: currentVersion,
					dontAskAgain: true,
				},
			} );
		} );
	} );
} );
