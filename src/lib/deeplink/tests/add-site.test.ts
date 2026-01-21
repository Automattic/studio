import { app, dialog, BrowserWindow } from 'electron';
import fs from 'fs-extra';
import { vi, beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { validateBlueprintData } from 'common/lib/blueprint-validation';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { handleAddSiteWithBlueprint } from 'src/lib/deeplink/handlers/add-site-with-blueprint';
import { download } from 'src/lib/download';
import { createMock } from 'src/lib/test-utils';
import { getMainWindow } from 'src/main-window';

vi.mock( 'fs-extra' );
vi.mock( 'src/ipc-utils' );
vi.mock( 'src/lib/download' );
vi.mock( 'src/main-window' );
vi.mock( 'common/lib/blueprint-validation', () => ( {
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
			response: 0,
			checkboxChecked: false,
		} );
	} );

	it( 'should handle add-site with valid blueprint_url', async () => {
		const blueprintUrl = 'https://example.com/blueprint.json';
		const url = createBlueprintUrl( blueprintUrl );

		vi.mocked( download ).mockResolvedValue( undefined );
		vi.mocked( fs.readJson ).mockResolvedValue( { steps: [] } );
		vi.mocked( validateBlueprintData ).mockResolvedValue( { valid: true, warnings: [] } );

		await handleAddSiteWithBlueprint( url );

		expect( download ).toHaveBeenCalledWith(
			blueprintUrl,
			expect.stringContaining( 'blueprint-' ),
			false,
			'blueprint'
		);
		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'add-site-with-blueprint', {
			blueprintPath: expect.stringContaining( 'blueprint-' ),
			warnings: [],
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
		vi.mocked( download ).mockRejectedValue( downloadError );
		vi.mocked( fs.remove ).mockImplementation( async () => {} );

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

		vi.mocked( mockMainWindow.isMinimized ).mockReturnValue( true );
		vi.mocked( download ).mockResolvedValue( undefined );
		vi.mocked( fs.readJson ).mockResolvedValue( { steps: [] } );
		vi.mocked( validateBlueprintData ).mockResolvedValue( { valid: true, warnings: [] } );

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
		expect( dialog.showMessageBox ).toHaveBeenCalledWith( mockMainWindow, {
			type: 'error',
			message: expect.any( String ),
			detail: 'Invalid Blueprint format',
			buttons: expect.any( Array ),
		} );
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
			vi.mocked( validateBlueprintData ).mockResolvedValue( { valid: true, warnings: [] } );

			await handleAddSiteWithBlueprint( url );

			expect( fs.writeJson ).toHaveBeenCalledWith(
				expect.stringContaining( 'blueprint-' ),
				blueprintData
			);
			expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'add-site-with-blueprint', {
				blueprintPath: expect.stringContaining( 'blueprint-' ),
				warnings: [],
			} );
			expect( download ).not.toHaveBeenCalled();
		} );

		it( 'should handle invalid base64-encoded Blueprint and display error message', async () => {
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
