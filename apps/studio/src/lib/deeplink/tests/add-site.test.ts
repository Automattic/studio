import { app, dialog, shell, BrowserWindow } from 'electron';
import { validateBlueprintData } from '@studio/common/lib/blueprint-validation';
import fs from 'fs-extra';
import { vi, beforeAll, afterAll } from 'vitest';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { handleAddSiteWithBlueprint } from 'src/lib/deeplink/handlers/add-site-with-blueprint';
import { download } from 'src/lib/download';
import { createMock } from 'src/lib/test-utils';
import { getMainWindow } from 'src/main-window';

vi.mock( 'fs-extra' );
vi.mock( 'src/ipc-utils' );
vi.mock( 'src/lib/download' );
vi.mock( 'src/main-window' );
vi.mock( 'src/logging', () => ( {
	getLogsFilePath: vi.fn().mockReturnValue( '/mock/path/to/logs.log' ),
} ) );
vi.mock( '@studio/common/lib/blueprint-validation', () => ( {
	validateBlueprintData: vi.fn(),
} ) );

// Silence console.error output
beforeAll( () => {
	vi.spyOn( console, 'error' ).mockImplementation( () => {} );
} );

afterAll( () => {
	vi.spyOn( console, 'error' ).mockRestore();
} );

describe( 'handleAddSiteWithBlueprint', () => {
	const mockMainWindow = createMock< BrowserWindow >( {
		isMinimized: vi.fn().mockReturnValue( false ),
		restore: vi.fn(),
		focus: vi.fn(),
	} );

	const expectErrorDialog = ( detail: string ) => {
		expect( dialog.showMessageBox ).toHaveBeenCalledWith( mockMainWindow, {
			type: 'error',
			message: 'Failed to load Blueprint',
			detail,
			buttons: [ 'Open Studio Logs', 'OK' ],
			defaultId: 1,
		} );
	};

	const createBlueprintUrl = ( blueprintUrl: string ) => {
		const encodedUrl = encodeURIComponent( blueprintUrl );
		return new URL( `wp-studio://add-site?blueprint_url=${ encodedUrl }` );
	};

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( mockMainWindow.isMinimized ).mockReturnValue( false );
		vi.mocked( app.getPath ).mockReturnValue( '/tmp' );
		vi.mocked( fs.mkdir ).mockImplementation( async () => {} );
		vi.mocked( getMainWindow ).mockResolvedValue( mockMainWindow );
		vi.mocked( dialog.showMessageBox ).mockResolvedValue( {
			response: 1,
			checkboxChecked: false,
		} );
	} );

	it( 'should handle add-site with valid blueprint_url', async () => {
		const blueprintUrl = 'https://example.com/blueprint.json';
		const url = createBlueprintUrl( blueprintUrl );

		vi.mocked( download ).mockResolvedValue( undefined );
		vi.mocked( fs.readJson ).mockResolvedValue( { steps: [] } );
		vi.mocked( validateBlueprintData ).mockResolvedValue( { valid: true } );

		await handleAddSiteWithBlueprint( url );

		expect( download ).toHaveBeenCalledWith(
			blueprintUrl,
			expect.stringContaining( 'blueprint-' ),
			false,
			'blueprint'
		);
		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'add-site-with-blueprint', {
			blueprintPath: expect.stringContaining( 'blueprint-' ),
		} );
		expect( mockMainWindow.focus ).toHaveBeenCalled();
	} );

	it( 'should not send event if blueprint_url parameter is missing', async () => {
		const url = new URL( 'wp-studio://add-site' );

		await handleAddSiteWithBlueprint( url );

		expect( download ).not.toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
	} );

	it( 'should handle invalid blueprint_url gracefully', async () => {
		const invalidUrl = 'not-a-valid-url';
		const encodedUrl = encodeURIComponent( invalidUrl );
		const url = new URL( `wp-studio://add-site?blueprint_url=${ encodedUrl }` );

		vi.mocked( fs.remove ).mockImplementation( async () => {} );

		await handleAddSiteWithBlueprint( url );

		expect( download ).not.toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		expectErrorDialog( 'Please check the link and try again.' );
	} );

	it( 'should handle download failure gracefully', async () => {
		const url = createBlueprintUrl( 'https://example.com/blueprint.json' );

		const downloadError = new Error( 'Download failed' );
		vi.mocked( download ).mockRejectedValue( downloadError );
		vi.mocked( fs.remove ).mockImplementation( async () => {} );

		await handleAddSiteWithBlueprint( url );

		expect( download ).toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		expect( fs.remove ).toHaveBeenCalledWith( expect.stringContaining( 'blueprint-' ) );
		expectErrorDialog( 'Please check the link and try again.' );
	} );

	it( 'should restore and focus window when minimized', async () => {
		const url = createBlueprintUrl( 'https://example.com/blueprint.json' );

		vi.mocked( mockMainWindow.isMinimized ).mockReturnValue( true );
		vi.mocked( download ).mockResolvedValue( undefined );
		vi.mocked( fs.readJson ).mockResolvedValue( { steps: [] } );
		vi.mocked( validateBlueprintData ).mockResolvedValue( { valid: true } );

		await handleAddSiteWithBlueprint( url );

		expect( mockMainWindow.restore ).toHaveBeenCalled();
		expect( mockMainWindow.focus ).toHaveBeenCalled();
	} );

	it( 'should handle cleanup errors gracefully on download failure', async () => {
		const url = createBlueprintUrl( 'https://example.com/blueprint.json' );

		const downloadError = new Error( 'Download failed' );
		vi.mocked( download ).mockRejectedValue( downloadError );
		vi.mocked( fs.remove ).mockRejectedValue( new Error( 'Cleanup failed' ) );

		await expect( handleAddSiteWithBlueprint( url ) ).resolves.not.toThrow();

		expect( dialog.showMessageBox ).toHaveBeenCalled();
	} );

	it( 'should handle invalid Blueprint and show error dialog', async () => {
		const url = createBlueprintUrl( 'https://example.com/blueprint.json' );

		vi.mocked( download ).mockResolvedValue( undefined );
		vi.mocked( fs.readJson ).mockResolvedValue( { invalid: 'data' } );
		vi.mocked( validateBlueprintData ).mockResolvedValue( {
			valid: false,
			error: 'Invalid Blueprint format',
		} );
		vi.mocked( fs.remove ).mockImplementation( async () => {} );

		await handleAddSiteWithBlueprint( url );

		expect( download ).toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		expect( fs.remove ).toHaveBeenCalledWith( expect.stringContaining( 'blueprint-' ) );
		expectErrorDialog( 'Please check the link and try again.' );
	} );

	describe( 'base64 blueprint handling', () => {
		it( 'should handle add-site with valid base64-encoded Blueprint', async () => {
			const blueprintData = {
				steps: [ { step: 'login', username: 'admin' } ],
				meta: { title: 'Test Blueprint', description: 'A test blueprint' },
			};
			const blueprintJson = JSON.stringify( blueprintData );
			const blueprintBase64 = Buffer.from( blueprintJson ).toString( 'base64' );
			const url = new URL( `wp-studio://add-site?blueprint=${ blueprintBase64 }` );

			vi.mocked( fs.writeJson ).mockImplementation( async () => {} );
			vi.mocked( validateBlueprintData ).mockResolvedValue( { valid: true } );

			await handleAddSiteWithBlueprint( url );

			expect( fs.writeJson ).toHaveBeenCalledWith(
				expect.stringContaining( 'blueprint-' ),
				blueprintData
			);
			expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'add-site-with-blueprint', {
				blueprintPath: expect.stringContaining( 'blueprint-' ),
			} );
			expect( download ).not.toHaveBeenCalled();
		} );

		it( 'should handle invalid base64-encoded Blueprint and display error message', async () => {
			const url = new URL( 'wp-studio://add-site?blueprint=invalid-base64!!!' );
			await handleAddSiteWithBlueprint( url );

			expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
			expectErrorDialog( 'Please check the link and try again.' );
		} );
	} );

	describe( 'user-friendly error messages', () => {
		it( 'should show user-friendly message for network connectivity errors', async () => {
			const url = createBlueprintUrl( 'https://example.com/blueprint.json' );

			vi.mocked( download ).mockRejectedValue( new Error( 'getaddrinfo ENOTFOUND example.com' ) );
			vi.mocked( fs.remove ).mockImplementation( async () => {} );

			await handleAddSiteWithBlueprint( url );

			expectErrorDialog(
				'Could not connect to the server. Please check your internet connection and try again.'
			);
		} );

		it( 'should show generic error message for other errors', async () => {
			const url = createBlueprintUrl( 'https://example.com/blueprint.json' );

			vi.mocked( download ).mockRejectedValue(
				new Error( 'Request failed with status code: 500' )
			);
			vi.mocked( fs.remove ).mockImplementation( async () => {} );

			await handleAddSiteWithBlueprint( url );

			expectErrorDialog( 'Please check the link and try again.' );
		} );

		it( 'should open logs file when user clicks Open Studio Logs button', async () => {
			const url = createBlueprintUrl( 'https://example.com/blueprint.json' );

			vi.mocked( download ).mockRejectedValue( new Error( 'Some error' ) );
			vi.mocked( fs.remove ).mockImplementation( async () => {} );
			vi.mocked( dialog.showMessageBox ).mockResolvedValue( {
				response: 0, // "Open Studio Logs" button
				checkboxChecked: false,
			} );

			await handleAddSiteWithBlueprint( url );

			expect( shell.openPath ).toHaveBeenCalledWith( '/mock/path/to/logs.log' );
		} );
	} );
} );
