import fs from 'fs';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import nock from 'nock';
import { registerCommand } from 'cli/commands/preview/create';
import { Logger } from 'cli/logger';

jest.mock( 'fs' );
jest.mock( 'cli/logger' );

describe( 'Preview Create Command', () => {
	const mockFolder = '/test/folder';
	const mockBasename = 'folder';
	const mockDate = 1234567890;
	const mockArchivePath = path.join( os.tmpdir(), `${ mockBasename }-${ mockDate }.zip` );
	const mockSiteUrl = 'https://test-preview.example.com';
	let program: Command;
	let mockLogger: Logger< string >;

	beforeEach( () => {
		jest.clearAllMocks();
		nock.cleanAll();

		// Mock Date.now()
		jest.spyOn( Date, 'now' ).mockReturnValue( mockDate );
		// Mock path.basename
		jest.spyOn( path, 'basename' ).mockReturnValue( mockBasename );

		program = new Command();
		mockLogger = {
			reportProgress: jest.fn(),
			reportError: jest.fn(),
		} as unknown as Logger< string >;

		( Logger as jest.Mock ).mockImplementation( () => mockLogger );
		( fs.unlinkSync as jest.Mock ).mockImplementation( () => {} );
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			// Mock a valid WordPress installation for tests
			if ( filePath.includes( mockFolder ) ) {
				return true;
			}
			if ( filePath.includes( 'wp-content' ) ) {
				return true;
			}
			if ( filePath.includes( 'wp-includes' ) ) {
				return true;
			}
			if ( filePath.includes( 'wp-load.php' ) ) {
				return true;
			}
			if ( filePath.includes( 'wp-config.php' ) ) {
				return true;
			}
			if ( filePath.includes( mockArchivePath ) ) {
				return true;
			}
			return true;
		} );

		nock( 'https://public-api.wordpress.com' )
			.post( '/wpcom/v2/jurassic-ninja/create-new-site-from-zip' )
			.reply( 200, { site_url: mockSiteUrl } );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should complete the preview creation process successfully', async () => {
		const mockWriteStream = {
			on: jest.fn( ( event, callback ) => {
				if ( event === 'close' ) {
					callback();
				}
			} ),
		};
		( fs.createWriteStream as jest.Mock ).mockReturnValue( mockWriteStream );

		// Mock console.log to capture output
		const consoleLogSpy = jest.spyOn( console, 'log' ).mockImplementation();

		registerCommand( program );
		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( fs.createWriteStream ).toHaveBeenCalledWith( mockArchivePath );
		expect( mockLogger.reportProgress ).toHaveBeenCalledTimes( 6 ); // All status messages
		expect( consoleLogSpy ).toHaveBeenCalledWith( mockSiteUrl );
		expect( fs.unlinkSync ).toHaveBeenCalledWith( mockArchivePath );
	} );

	it( 'should use current directory when no folder is specified', async () => {
		const mockWriteStream = {
			on: jest.fn( ( event, callback ) => {
				if ( event === 'close' ) {
					callback();
				}
			} ),
		};
		( fs.createWriteStream as jest.Mock ).mockReturnValue( mockWriteStream );

		registerCommand( program );
		await program.parseAsync( [ 'node', 'test', 'go' ] );

		// Path.basename mocked to return mockBasename
		expect( fs.createWriteStream ).toHaveBeenCalledWith( mockArchivePath );
		expect( fs.unlinkSync ).toHaveBeenCalledWith( mockArchivePath );
	} );

	it( 'should handle errors gracefully', async () => {
		const mockError = new Error( 'Test error' );
		( fs.createWriteStream as jest.Mock ).mockImplementation( () => {
			throw mockError;
		} );

		registerCommand( program );
		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalledWith( mockError.message );
	} );

	it( 'should handle API errors gracefully', async () => {
		nock.cleanAll();
		nock( 'https://public-api.wordpress.com' )
			.post( '/wpcom/v2/jurassic-ninja/create-new-site-from-zip' )
			.reply( 500, { error: 'Server error' } );

		const mockWriteStream = {
			on: jest.fn( ( event, callback ) => {
				if ( event === 'close' ) {
					callback();
				}
			} ),
		};
		( fs.createWriteStream as jest.Mock ).mockReturnValue( mockWriteStream );

		registerCommand( program );
		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
	} );

	it( 'should fail if the folder is not a WordPress site', async () => {
		// Override existsSync to make the WordPress checks fail
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			if ( filePath.includes( 'wp-content' ) ) {
				return false;
			}
			return true;
		} );

		registerCommand( program );
		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith(
			expect.stringContaining( 'WordPress site' )
		);
	} );
} );
