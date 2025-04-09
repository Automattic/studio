import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { uploadArchive, waitForSiteReady } from 'cli/commands/preview/lib/api';
import { createArchive, cleanup } from 'cli/commands/preview/lib/archive';
import { getAuthToken } from 'cli/commands/preview/lib/auth';
import { addPreviewSiteToAppdata } from 'cli/commands/preview/lib/snapshots';
import { validateSiteFolder } from 'cli/commands/preview/lib/validation';
import { Logger, LoggerError } from 'cli/logger';

jest.mock( 'cli/commands/preview/lib/auth' );
jest.mock( 'cli/commands/preview/lib/validation' );
jest.mock( 'cli/commands/preview/lib/archive' );
jest.mock( 'cli/commands/preview/lib/api' );
jest.mock( 'cli/commands/preview/lib/snapshots' );
jest.mock( 'cli/logger', () => {
	const originalModule = jest.requireActual( 'cli/logger' );

	// Return the real LoggerError class to ensure instanceof checks work correctly
	return {
		LoggerError: originalModule.LoggerError,
		Logger: jest.fn().mockImplementation( () => {
			const reportStart = jest.fn();
			const reportSuccess = jest.fn();
			const reportError = jest.fn();
			return {
				reportStart,
				reportSuccess,
				reportError,
			};
		} ),
	};
} );

describe( 'Preview Create Command', () => {
	const mockFolder = '/test/folder';
	const mockBasename = 'folder';
	const mockDate = 1234567890;
	const mockArchivePath = path.join( os.tmpdir(), `${ mockBasename }-${ mockDate }.zip` );
	const mockSiteUrl = 'test-preview.example.com';
	const mockSiteId = 12345;
	const mockAuthToken = { accessToken: 'mock-auth-token', id: 123 };
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
		};

		( Logger as jest.Mock ).mockReturnValue( mockLogger );

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
		expect( validateSiteFolder ).toHaveBeenCalledWith( mockFolder );
		expect( mockLogger.reportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating...' ] );
		expect( mockLogger.reportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Validation successful' ] );

		// Verify archive step
		expect( createArchive ).toHaveBeenCalledWith( mockFolder, mockArchivePath );
		expect( mockLogger.reportStart.mock.calls[ 1 ] ).toEqual( [
			'archive',
			'Creating archive...',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 1 ] ).toEqual( [ 'Archive created' ] );

		// Verify upload step
		expect( uploadArchive ).toHaveBeenCalledWith( mockArchivePath, mockAuthToken.accessToken );
		expect( mockLogger.reportStart.mock.calls[ 2 ] ).toEqual( [
			'upload',
			'Uploading archive...',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 2 ] ).toEqual( [ 'Archive uploaded' ] );

		// Verify site ready step
		expect( waitForSiteReady ).toHaveBeenCalledWith( mockSiteId, mockAuthToken.accessToken );
		expect( mockLogger.reportStart.mock.calls[ 3 ] ).toEqual( [
			'ready',
			'Creating preview site...',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 3 ] ).toEqual( [
			`Preview site available at: https://${ mockSiteUrl }`,
		] );

		// Verify appdata step
		expect( addPreviewSiteToAppdata ).toHaveBeenCalledWith( mockSiteUrl, mockSiteId, mockFolder );
		expect( mockLogger.reportStart.mock.calls[ 4 ] ).toEqual( [
			'appdata',
			'Saving preview site to Studio...',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 4 ] ).toEqual( [
			'Preview site saved to Studio',
		] );

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
		const errorMessage = 'Validation failed';
		( validateSiteFolder as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( createArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle authentication errors', async () => {
		const errorMessage =
			'Authentication required. Please run the Studio app and authenticate first.';
		( getAuthToken as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( createArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle archive creation errors', async () => {
		const errorMessage = 'Archive creation failed';
		( createArchive as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( uploadArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle upload errors', async () => {
		const errorMessage = 'Upload failed';
		( uploadArchive as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( waitForSiteReady ).not.toHaveBeenCalled();
	} );

	it( 'should handle site readiness errors', async () => {
		const errorMessage = 'Failed to create preview site';
		( waitForSiteReady as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( addPreviewSiteToAppdata ).not.toHaveBeenCalled();
	} );

	it( 'should handle appdata errors', async () => {
		const errorMessage = 'Failed to save to appdata';
		( addPreviewSiteToAppdata as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'should always clean up archive file even on error', async () => {
		( uploadArchive as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( 'Upload failed' );
		} );

		const { registerCommand } = await import( '../create' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( cleanup ).toHaveBeenCalledWith( mockArchivePath );
	} );
} );
