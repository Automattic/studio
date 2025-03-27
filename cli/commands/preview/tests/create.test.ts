import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { uploadArchive, waitForSiteReady } from 'cli/commands/preview/lib/api';
import { addPreviewSiteToAppdata } from 'cli/commands/preview/lib/appdata';
import { createArchive, cleanup } from 'cli/commands/preview/lib/archive';
import { getAuthToken } from 'cli/commands/preview/lib/auth';
import { validateSiteFolder } from 'cli/commands/preview/lib/validation';
import { Logger, LoggerError } from 'cli/logger';

// Mock ora
jest.mock( 'ora', () => {
	return {
		__esModule: true,
		default: () => ( {
			start: jest.fn().mockReturnThis(),
			stop: jest.fn().mockReturnThis(),
			succeed: jest.fn().mockReturnThis(),
			fail: jest.fn().mockReturnThis(),
		} ),
	};
} );

// Import types from create.ts
type LoggerAction = 'validate' | 'archive' | 'upload' | 'ready' | 'appdata';

jest.mock( '../lib/auth' );
jest.mock( '../lib/validation' );
jest.mock( '../lib/archive' );
jest.mock( '../lib/api' );
jest.mock( '../lib/appdata' );
jest.mock( 'cli/logger', () => {
	const originalModule = jest.requireActual( 'cli/logger' );

	// Return the real LoggerError class to ensure instanceof checks work correctly
	return {
		LoggerError: originalModule.LoggerError,
		Logger: jest.fn().mockImplementation( () => ( {
			reportStart: jest.fn(),
			reportSuccess: jest.fn(),
			reportError: jest.fn(),
		} ) ),
	};
} );

describe( 'Preview Create Command', () => {
	const mockFolder = '/test/folder';
	const mockBasename = 'folder';
	const mockDate = 1234567890;
	const mockArchivePath = path.join( os.tmpdir(), `${ mockBasename }-${ mockDate }.zip` );
	const mockSiteUrl = 'test-preview.example.com';
	const mockSiteId = 12345;
	const mockAuthToken = 'mock-auth-token';
	const mockArchiver = {
		on: jest.fn(),
		pipe: jest.fn(),
		directory: jest.fn(),
		file: jest.fn(),
		finalize: jest.fn(),
	};
	let program: Command;
	let mockLogger: {
		reportStart: jest.Mock;
		reportSuccess: jest.Mock;
		reportError: jest.Mock;
	};
	// This will store the error object passed to reportError for validation
	let mockErrorData: LoggerError< string > | null;

	beforeEach( () => {
		jest.clearAllMocks();
		mockErrorData = null;
		jest.spyOn( Date, 'now' ).mockReturnValue( mockDate );
		jest.spyOn( path, 'basename' ).mockReturnValue( mockBasename );
		jest.spyOn( process, 'cwd' ).mockReturnValue( mockFolder );

		program = new Command();
		mockLogger = {
			reportStart: jest.fn(),
			reportSuccess: jest.fn(),
			reportError: jest.fn().mockImplementation( ( error ) => {
				// Store the error object for testing
				mockErrorData = error;
			} ),
		};

		( Logger as jest.Mock ).mockImplementation( () => mockLogger );

		// Mock auth
		( getAuthToken as jest.Mock ).mockResolvedValue( mockAuthToken );

		// Mock validation
		( validateSiteFolder as jest.Mock ).mockReturnValue( true );

		// Mock archive
		( createArchive as jest.Mock ).mockResolvedValue( mockArchiver );
		( cleanup as jest.Mock ).mockImplementation( () => {} );

		// Mock API
		( uploadArchive as jest.Mock ).mockResolvedValue( {
			site_url: mockSiteUrl,
			site_id: mockSiteId,
		} );
		( waitForSiteReady as jest.Mock ).mockResolvedValue( true );

		// Mock appdata
		( addPreviewSiteToAppdata as jest.Mock ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should complete the preview creation process successfully', async () => {
		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		// Verify validation step
		expect( validateSiteFolder ).toHaveBeenCalledWith( mockFolder, 'validate' );
		expect( mockLogger.reportStart ).toHaveBeenCalledWith(
			'validate' as LoggerAction,
			'Validating...'
		);
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
			'validate' as LoggerAction,
			'Validation successful'
		);

		// Verify archive step
		expect( createArchive ).toHaveBeenCalledWith( mockFolder, mockArchivePath, 'archive' );
		expect( mockLogger.reportStart ).toHaveBeenCalledWith(
			'archive' as LoggerAction,
			'Creating archive...'
		);
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
			'archive' as LoggerAction,
			'Archive created'
		);

		// Verify upload step
		expect( uploadArchive ).toHaveBeenCalledWith( mockArchivePath, mockAuthToken, 'upload' );
		expect( mockLogger.reportStart ).toHaveBeenCalledWith(
			'upload' as LoggerAction,
			'Uploading archive...'
		);
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
			'upload' as LoggerAction,
			'Archive uploaded'
		);

		// Verify site ready step
		expect( waitForSiteReady ).toHaveBeenCalledWith( mockSiteId, mockAuthToken, 'ready' );
		expect( mockLogger.reportStart ).toHaveBeenCalledWith(
			'ready' as LoggerAction,
			'Creating preview site...'
		);
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
			'ready' as LoggerAction,
			`Preview site available at: https://${ mockSiteUrl }`
		);

		// Verify appdata step
		expect( addPreviewSiteToAppdata ).toHaveBeenCalledWith(
			mockSiteUrl,
			mockSiteId,
			mockFolder,
			'appdata'
		);
		expect( mockLogger.reportStart ).toHaveBeenCalledWith(
			'appdata' as LoggerAction,
			'Saving preview site to Studio...'
		);
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
			'appdata' as LoggerAction,
			'Preview site saved to Studio'
		);

		// Verify cleanup
		expect( cleanup ).toHaveBeenCalledWith( mockArchivePath );
	} );

	it( 'should use current directory when no folder is specified', async () => {
		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go' ] );

		expect( validateSiteFolder ).toHaveBeenCalledWith( process.cwd(), 'validate' );
	} );

	it( 'should handle validation errors', async () => {
		const errorMessage = 'Validation failed';
		( validateSiteFolder as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage, 'validate' );
		} );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockErrorData ).toHaveProperty( 'message', errorMessage );
		expect( mockErrorData ).toHaveProperty( 'action', 'validate' );
		expect( createArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle authentication errors', async () => {
		const errorMessage =
			'Authentication required. Please run the Studio app and authenticate first.';
		( getAuthToken as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage, 'validate' );
		} );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockErrorData ).toHaveProperty( 'message', errorMessage );
		expect( mockErrorData ).toHaveProperty( 'action', 'validate' );
		expect( createArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle archive creation errors', async () => {
		const errorMessage = 'Archive creation failed';
		( createArchive as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage, 'archive' );
		} );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockErrorData ).toHaveProperty( 'message', errorMessage );
		expect( mockErrorData ).toHaveProperty( 'action', 'archive' );
		expect( uploadArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle upload errors', async () => {
		const errorMessage = 'Upload failed';
		( uploadArchive as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage, 'upload' );
		} );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockErrorData ).toHaveProperty( 'message', errorMessage );
		expect( mockErrorData ).toHaveProperty( 'action', 'upload' );
		expect( waitForSiteReady ).not.toHaveBeenCalled();
	} );

	it( 'should handle site readiness errors', async () => {
		const errorMessage = 'Failed to create preview site';
		( waitForSiteReady as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage, 'ready' );
		} );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockErrorData ).toHaveProperty( 'message', errorMessage );
		expect( mockErrorData ).toHaveProperty( 'action', 'ready' );
		expect( addPreviewSiteToAppdata ).not.toHaveBeenCalled();
	} );

	it( 'should handle appdata errors', async () => {
		const errorMessage = 'Failed to save to appdata';
		( addPreviewSiteToAppdata as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage, 'appdata' );
		} );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockErrorData ).toHaveProperty( 'message', errorMessage );
		expect( mockErrorData ).toHaveProperty( 'action', 'appdata' );
	} );

	it( 'should always clean up archive file even on error', async () => {
		( uploadArchive as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( 'Upload failed', 'upload' );
		} );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( cleanup ).toHaveBeenCalledWith( mockArchivePath );
	} );

	it( 'should handle unexpected errors', async () => {
		const errorMessage = 'Unexpected error';
		const unexpectedError = new Error( errorMessage );
		( validateSiteFolder as jest.Mock ).mockImplementation( () => {
			throw unexpectedError;
		} );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockErrorData ).toHaveProperty( 'message', errorMessage );
		expect( mockErrorData ).toHaveProperty( 'action', 'validate' );
		expect( createArchive ).not.toHaveBeenCalled();
	} );
} );
