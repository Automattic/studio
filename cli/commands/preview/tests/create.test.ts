import fs from 'fs';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import nock from 'nock';
import { registerCommand } from 'cli/commands/preview/create';
import { Logger } from 'cli/logger';

jest.mock( 'fs' );
jest.mock( 'cli/logger' );

// Mock archiver module
const mockArchiver = {
	on: jest.fn(),
	pipe: jest.fn(),
	directory: jest.fn(),
	file: jest.fn(),
	finalize: jest.fn(),
};
jest.mock( 'archiver', () => () => mockArchiver );

describe( 'Preview Create Command', () => {
	const mockFolder = '/test/folder';
	const mockBasename = 'folder';
	const mockDate = 1234567890;
	const mockArchivePath = path.join( os.tmpdir(), `${ mockBasename }-${ mockDate }.zip` );
	const mockSiteUrl = 'https://test-preview.example.com';
	const mockAuthToken = 'mock-auth-token';
	let program: Command;
	let mockLogger: Logger< string >;

	beforeEach( () => {
		jest.clearAllMocks();
		nock.cleanAll();

		// Mock Date.now()
		jest.spyOn( Date, 'now' ).mockReturnValue( mockDate );
		// Mock path.basename
		jest.spyOn( path, 'basename' ).mockReturnValue( mockBasename );
		// Mock process.cwd()
		jest.spyOn( process, 'cwd' ).mockReturnValue( mockFolder );

		program = new Command();
		mockLogger = {
			reportProgress: jest.fn(),
			reportError: jest.fn(),
		} as unknown as Logger< string >;

		( Logger as jest.Mock ).mockImplementation( () => mockLogger );
		( fs.unlinkSync as jest.Mock ).mockImplementation( () => {} );
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			// Mock a minimal WordPress setup (just wp-content)
			if (
				filePath.includes( mockFolder ) ||
				filePath.includes( 'wp-content' ) ||
				filePath.includes( mockArchivePath )
			) {
				return true;
			}
			// Mock auth token file
			if ( filePath.includes( 'appdata-v1.json' ) ) {
				return true;
			}
			return false;
		} );

		( fs.readFileSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			if ( filePath.includes( 'appdata-v1.json' ) ) {
				return JSON.stringify( { authToken: { accessToken: mockAuthToken } } );
			}
			if ( filePath.includes( mockArchivePath ) ) {
				return Buffer.from( 'mock file content' );
			}
			return '';
		} );

		// Mock successful API response with proper event emulation
		const mockWriteStream: { on: jest.Mock } = {
			on: jest.fn().mockImplementation( ( event, callback ) => {
				if ( event === 'close' ) {
					// Ensure the close callback is called after a short delay
					setTimeout( callback, 0 );
				}
				return mockWriteStream;
			} ),
		};
		( fs.createWriteStream as jest.Mock ).mockReturnValue( mockWriteStream );

		nock( 'https://public-api.wordpress.com' )
			.post( '/wpcom/v2/jurassic-ninja/create-new-site-from-zip', ( body ) => {
				// Verify the request includes both the auth token and proper multipart form data
				return (
					body.includes(
						'Content-Disposition: form-data; name="import"; filename="local-env-site-1.zip"'
					) &&
					body.includes( 'Content-Type: application/zip' ) &&
					body.includes( 'mock file content' )
				);
			} )
			.reply(
				200,
				{ site_url: mockSiteUrl },
				{
					'content-type': 'application/json',
				}
			);

		// Reset archiver mock
		mockArchiver.on.mockImplementation( ( event, callback ) => {
			if ( event === 'error' ) {
				// Don't call error callback
			} else if ( event === 'end' ) {
				// Simulate successful archive creation
				setTimeout( () => callback(), 0 );
			}
			return mockArchiver;
		} );
		mockArchiver.pipe.mockReturnValue( mockArchiver );
		mockArchiver.directory.mockReturnValue( mockArchiver );
		mockArchiver.file.mockReturnValue( mockArchiver );
		mockArchiver.finalize.mockImplementation( () => {
			// Simulate successful archive creation
			const mockWriteStream = {
				on: jest.fn( ( event, callback ) => {
					if ( event === 'close' ) {
						setTimeout( () => callback(), 0 );
					}
				} ),
			};
			( fs.createWriteStream as jest.Mock ).mockReturnValue( mockWriteStream );
			return Promise.resolve();
		} );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should complete the preview creation process successfully', ( done ) => {
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
		program.parseAsync( [ 'node', 'test', 'go', mockFolder ] ).then( () => {
			try {
				expect( fs.createWriteStream ).toHaveBeenCalledWith( mockArchivePath );
				expect( mockLogger.reportProgress ).toHaveBeenCalledWith( 'Creating archive...' );
				expect( mockLogger.reportProgress ).toHaveBeenCalledWith( 'Archive created' );
				expect( mockLogger.reportProgress ).toHaveBeenCalledWith( 'Uploading archive...' );
				expect( mockLogger.reportProgress ).toHaveBeenCalledWith( 'Archive uploaded' );
				expect( mockLogger.reportProgress ).toHaveBeenCalledWith( 'Preview site available at:' );
				expect( mockLogger.reportProgress ).toHaveBeenCalledWith( 'Temporary files cleaned up' );
				expect( consoleLogSpy ).toHaveBeenCalledWith( mockSiteUrl );
				expect( fs.unlinkSync ).toHaveBeenCalledWith( mockArchivePath );
				done();
			} catch ( error ) {
				done( error );
			}
		} );
	} );

	it( 'should use current directory when no folder is specified', ( done ) => {
		const mockWriteStream = {
			on: jest.fn( ( event, callback ) => {
				if ( event === 'close' ) {
					callback();
				}
			} ),
		};
		( fs.createWriteStream as jest.Mock ).mockReturnValue( mockWriteStream );

		registerCommand( program );
		program.parseAsync( [ 'node', 'test', 'go' ] ).then( () => {
			try {
				// Should use process.cwd() when no folder is specified
				expect( fs.createWriteStream ).toHaveBeenCalledWith( mockArchivePath );
				expect( fs.unlinkSync ).toHaveBeenCalledWith( mockArchivePath );
				done();
			} catch ( error ) {
				done( error );
			}
		} );
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

	it( 'should fail if the folder does not contain wp-content', async () => {
		// Override existsSync to make wp-content check fail
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			if ( filePath.includes( 'wp-content' ) ) {
				return false;
			}
			return true;
		} );

		registerCommand( program );
		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalledWith(
			expect.stringContaining( 'Please ensure it contains a wp-content directory' )
		);
	} );

	it( 'should include wp-config.php if it exists', async () => {
		const mockWriteStream = {
			on: jest.fn( ( event, callback ) => {
				if ( event === 'close' ) {
					callback();
				}
			} ),
		};
		( fs.createWriteStream as jest.Mock ).mockReturnValue( mockWriteStream );

		// Mock wp-config.php existence
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			if ( filePath.includes( 'wp-config.php' ) ) {
				return true;
			}
			return (
				filePath.includes( mockFolder ) ||
				filePath.includes( 'wp-content' ) ||
				filePath.includes( mockArchivePath ) ||
				filePath.includes( 'appdata-v1.json' )
			);
		} );

		registerCommand( program );
		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockArchiver.file ).toHaveBeenCalledWith( path.join( mockFolder, 'wp-config.php' ), {
			name: 'wp-config.php',
		} );
	} );

	it( 'should fail if authentication token is not found', async () => {
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			if ( filePath.includes( 'appdata-v1.json' ) ) {
				return false;
			}
			return true;
		} );

		registerCommand( program );
		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportProgress ).toHaveBeenCalledWith(
			'Authentication required. Please run the electron app and authenticate first.'
		);
	} );
} );
