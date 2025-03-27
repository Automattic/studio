import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { uploadArchive, waitForSiteReady } from 'cli/commands/preview/lib/api';
import { createArchive, cleanup } from 'cli/commands/preview/lib/archive';
import { getAuthToken } from 'cli/commands/preview/lib/auth';
import { validateSiteFolder } from 'cli/commands/preview/lib/validation';
import { Logger } from 'cli/logger';

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
type LoggerAction = 'validate' | 'archive' | 'upload' | 'ready';

jest.mock( '../lib/auth' );
jest.mock( '../lib/validation' );
jest.mock( '../lib/archive' );
jest.mock( '../lib/api' );
jest.mock( 'cli/logger' );

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
	let mockLogger: Logger< LoggerAction >;

	beforeEach( () => {
		jest.clearAllMocks();
		jest.spyOn( Date, 'now' ).mockReturnValue( mockDate );
		jest.spyOn( path, 'basename' ).mockReturnValue( mockBasename );
		jest.spyOn( process, 'cwd' ).mockReturnValue( mockFolder );

		program = new Command();
		mockLogger = {
			reportStart: jest.fn(),
			reportSuccess: jest.fn(),
			reportError: jest.fn(),
		} as unknown as Logger< LoggerAction >;

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
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should complete the preview creation process successfully', async () => {
		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		// Verify validation step
		expect( validateSiteFolder ).toHaveBeenCalledWith( mockFolder );
		expect( mockLogger.reportStart ).toHaveBeenCalledWith(
			'validate' as LoggerAction,
			'Validating...'
		);
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
			'validate' as LoggerAction,
			'Validation successful'
		);

		// Verify archive step
		expect( createArchive ).toHaveBeenCalledWith( mockFolder, mockArchivePath );
		expect( mockLogger.reportStart ).toHaveBeenCalledWith(
			'archive' as LoggerAction,
			'Creating archive...'
		);
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
			'archive' as LoggerAction,
			'Archive created'
		);

		// Verify upload step
		expect( uploadArchive ).toHaveBeenCalledWith( mockArchivePath, mockAuthToken );
		expect( mockLogger.reportStart ).toHaveBeenCalledWith(
			'upload' as LoggerAction,
			'Uploading archive...'
		);
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
			'upload' as LoggerAction,
			'Archive uploaded'
		);

		// Verify site ready step
		expect( waitForSiteReady ).toHaveBeenCalledWith( mockSiteId, mockAuthToken );
		expect( mockLogger.reportStart ).toHaveBeenCalledWith(
			'ready' as LoggerAction,
			'Creating preview site...'
		);
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
			'ready' as LoggerAction,
			`Preview site available at: https://${ mockSiteUrl }`
		);

		// Verify cleanup
		expect( cleanup ).toHaveBeenCalledWith( mockArchivePath );
	} );

	it( 'should use current directory when no folder is specified', async () => {
		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go' ] );

		expect( validateSiteFolder ).toHaveBeenCalledWith( process.cwd() );
	} );

	it( 'should handle validation errors', async () => {
		const mockError = new Error( 'Validation failed' );
		( validateSiteFolder as jest.Mock ).mockReturnValue( mockError );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalledWith(
			'validate' as LoggerAction,
			mockError.message
		);
		expect( createArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle missing auth token', async () => {
		( getAuthToken as jest.Mock ).mockResolvedValue( null );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalledWith(
			'validate' as LoggerAction,
			'Authentication required. Please run the Studio app and authenticate first.'
		);
		expect( createArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle archive creation errors', async () => {
		const mockError = new Error( 'Archive creation failed' );
		( createArchive as jest.Mock ).mockResolvedValue( mockError );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalledWith(
			'archive' as LoggerAction,
			mockError.message
		);
		expect( uploadArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle upload errors', async () => {
		const mockError = new Error( 'Upload failed' );
		( uploadArchive as jest.Mock ).mockResolvedValue( mockError );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalledWith(
			'upload' as LoggerAction,
			mockError.message
		);
		expect( waitForSiteReady ).not.toHaveBeenCalled();
	} );

	it( 'should handle site readiness timeout', async () => {
		( waitForSiteReady as jest.Mock ).mockResolvedValue( false );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalledWith(
			'ready' as LoggerAction,
			'Failed to create preview site'
		);
	} );
} );
