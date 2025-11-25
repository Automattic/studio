/**
 * @jest-environment node
 */
import { app, dialog, BrowserWindow } from 'electron';
import fs from 'fs-extra';
import { validateBlueprintData } from 'common/lib/blueprint-validation';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { handleAddSiteWithBlueprint } from 'src/lib/deeplink/handlers/add-site-with-blueprint';
import { download } from 'src/lib/download';
import { getMainWindow } from 'src/main-window';

jest.mock( 'electron' );
jest.mock( 'fs-extra' );
jest.mock( 'src/ipc-utils' );
jest.mock( 'src/lib/download' );
jest.mock( 'src/main-window' );
jest.mock( 'common/lib/blueprint-validation', () => ( {
	validateBlueprintData: jest.fn(),
} ) );

// Silence console.error output
beforeAll( () => {
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
} );

afterAll( () => {
	jest.spyOn( console, 'error' ).mockRestore();
} );

describe( 'handleAddSiteWithBlueprint', () => {
	const mockMainWindow = {
		isMinimized: jest.fn().mockReturnValue( false ),
		restore: jest.fn(),
		focus: jest.fn(),
	} as unknown as BrowserWindow;

	const createBlueprintUrl = ( blueprintUrl: string ) => {
		const encodedUrl = encodeURIComponent( blueprintUrl );
		return new URL( `wp-studio://add-site?blueprint_url=${ encodedUrl }` );
	};

	beforeEach( () => {
		jest.clearAllMocks();
		( mockMainWindow.isMinimized as jest.Mock ).mockReturnValue( false );
		jest.mocked( app.getPath ).mockReturnValue( '/tmp' );
		jest.mocked( fs.mkdir ).mockImplementation( async () => {} );
		jest.mocked( getMainWindow ).mockResolvedValue( mockMainWindow );
		jest.mocked( dialog.showMessageBox ).mockResolvedValue( {
			response: 0,
			checkboxChecked: false,
		} );
	} );

	it( 'should handle add-site with valid blueprint_url', async () => {
		const blueprintUrl = 'https://example.com/blueprint.json';
		const url = createBlueprintUrl( blueprintUrl );

		jest.mocked( download ).mockResolvedValue( undefined );
		jest.mocked( fs.readJson ).mockResolvedValue( { steps: [] } );
		jest.mocked( validateBlueprintData ).mockResolvedValue( { valid: true } );

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

		jest.mocked( fs.remove ).mockImplementation( async () => {} );

		await handleAddSiteWithBlueprint( url );

		expect( download ).not.toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		expect( dialog.showMessageBox ).toHaveBeenCalledWith( mockMainWindow, {
			type: 'error',
			message: expect.any( String ),
			detail: expect.any( String ),
			buttons: expect.any( Array ),
		} );
	} );

	it( 'should handle download failure gracefully', async () => {
		const url = createBlueprintUrl( 'https://example.com/blueprint.json' );

		const downloadError = new Error( 'Download failed' );
		jest.mocked( download ).mockRejectedValue( downloadError );
		jest.mocked( fs.remove ).mockImplementation( async () => {} );

		await handleAddSiteWithBlueprint( url );

		expect( download ).toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		expect( fs.remove ).toHaveBeenCalledWith( expect.stringContaining( 'blueprint-' ) );
		expect( dialog.showMessageBox ).toHaveBeenCalledWith( mockMainWindow, {
			type: 'error',
			message: expect.any( String ),
			detail: expect.any( String ),
			buttons: expect.any( Array ),
		} );
	} );

	it( 'should restore and focus window when minimized', async () => {
		const url = createBlueprintUrl( 'https://example.com/blueprint.json' );

		( mockMainWindow.isMinimized as jest.Mock ).mockReturnValue( true );
		jest.mocked( download ).mockResolvedValue( undefined );
		jest.mocked( fs.readJson ).mockResolvedValue( { steps: [] } );
		jest.mocked( validateBlueprintData ).mockResolvedValue( { valid: true } );

		await handleAddSiteWithBlueprint( url );

		expect( mockMainWindow.restore ).toHaveBeenCalled();
		expect( mockMainWindow.focus ).toHaveBeenCalled();
	} );

	it( 'should handle cleanup errors gracefully on download failure', async () => {
		const url = createBlueprintUrl( 'https://example.com/blueprint.json' );

		const downloadError = new Error( 'Download failed' );
		jest.mocked( download ).mockRejectedValue( downloadError );
		( fs.remove as unknown as jest.Mock ).mockRejectedValue( new Error( 'Cleanup failed' ) );

		await expect( handleAddSiteWithBlueprint( url ) ).resolves.not.toThrow();

		expect( dialog.showMessageBox ).toHaveBeenCalled();
	} );

	it( 'should handle invalid blueprint and show error dialog', async () => {
		const url = createBlueprintUrl( 'https://example.com/blueprint.json' );

		jest.mocked( download ).mockResolvedValue( undefined );
		jest.mocked( fs.readJson ).mockResolvedValue( { invalid: 'data' } );
		jest.mocked( validateBlueprintData ).mockResolvedValue( {
			valid: false,
			error: 'Invalid blueprint format',
		} );
		jest.mocked( fs.remove ).mockImplementation( async () => {} );

		await handleAddSiteWithBlueprint( url );

		expect( download ).toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		expect( fs.remove ).toHaveBeenCalledWith( expect.stringContaining( 'blueprint-' ) );
		expect( dialog.showMessageBox ).toHaveBeenCalledWith( mockMainWindow, {
			type: 'error',
			message: expect.any( String ),
			detail: 'Invalid blueprint format',
			buttons: expect.any( Array ),
		} );
	} );

	describe( 'base64 blueprint handling', () => {
		it( 'should handle add-site with valid base64-encoded blueprint', async () => {
			const blueprintData = {
				steps: [ { step: 'login', username: 'admin' } ],
				meta: { title: 'Test Blueprint', description: 'A test blueprint' },
			};
			const blueprintJson = JSON.stringify( blueprintData );
			const blueprintBase64 = Buffer.from( blueprintJson ).toString( 'base64' );
			const url = new URL( `wp-studio://add-site?blueprint=${ blueprintBase64 }` );

			jest.mocked( fs.writeJson ).mockImplementation( async () => {} );
			jest.mocked( validateBlueprintData ).mockResolvedValue( { valid: true } );

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

		it( 'should handle invalid base64-encoded blueprint and display error message', async () => {
			const url = new URL( 'wp-studio://add-site?blueprint=invalid-base64!!!' );
			await handleAddSiteWithBlueprint( url );

			expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
			expect( dialog.showMessageBox ).toHaveBeenCalledWith( mockMainWindow, {
				type: 'error',
				message: expect.any( String ),
				detail: expect.any( String ),
				buttons: expect.any( Array ),
			} );
		} );
	} );
} );
