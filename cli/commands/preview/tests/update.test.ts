import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { createArchive } from 'cli/lib/archive';
import { getAuthToken } from 'cli/lib/auth';
import { addPreviewSiteToAppdata, getSnapshotsFromAppdata } from 'cli/lib/snapshots';
import { validateSiteFolder } from 'cli/lib/validation';
import { Logger, LoggerError } from 'cli/logger';

jest.mock( 'cli/lib/auth' );
jest.mock( 'cli/lib/validation' );
jest.mock( 'cli/lib/archive' );
jest.mock( 'cli/lib/api' );
jest.mock( 'cli/lib/snapshots' );
jest.mock( 'cli/logger' );

describe( 'Preview Update Command', () => {
	const mockFolder = '/test/folder';
	const mockBasename = 'folder';
	const mockDate = 1234567890;
	const mockArchivePath = path.join( os.tmpdir(), `${ mockBasename }-${ mockDate }.zip` );
	const mockSiteUrl = 'test-preview.example.com';
	const mockAtomicSiteId = 12345;
	const mockAuthToken = { accessToken: 'mock-auth-token', id: 123 };
	const mockSnapshot = {
		url: mockSiteUrl,
		atomicSiteId: mockAtomicSiteId,
		localSiteId: '456',
		date: Date.now(),
		name: 'Test Snapshot',
		userId: 123,
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

		program = new Command( 'studio' );
		mockLogger = {
			reportStart: jest.fn(),
			reportSuccess: jest.fn(),
			reportError: jest.fn(),
		};

		( Logger as jest.Mock ).mockReturnValue( mockLogger );

		( getAuthToken as jest.Mock ).mockResolvedValue( mockAuthToken );
		( validateSiteFolder as jest.Mock ).mockReturnValue( true );
		( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [ mockSnapshot ] );
		( createArchive as jest.Mock ).mockResolvedValue( undefined );
		( uploadArchive as jest.Mock ).mockResolvedValue( {
			site_url: mockSiteUrl,
			site_id: mockAtomicSiteId,
		} );
		( waitForSiteReady as jest.Mock ).mockResolvedValue( true );
		( addPreviewSiteToAppdata as jest.Mock ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should complete the preview update process successfully', async () => {
		const { registerCommand } = await import( '../update' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'studio', 'update', mockFolder, '--host', mockSiteUrl ] );

		expect( validateSiteFolder ).toHaveBeenCalledWith( mockFolder );
		expect( mockLogger.reportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating...' ] );
		expect( mockLogger.reportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Validation successful' ] );

		expect( createArchive ).toHaveBeenCalledWith( mockFolder, mockArchivePath );
		expect( mockLogger.reportStart.mock.calls[ 1 ] ).toEqual( [
			'archive',
			'Creating archive...',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 1 ] ).toEqual( [ 'Archive created' ] );

		expect( uploadArchive ).toHaveBeenCalledWith(
			mockArchivePath,
			mockAuthToken.accessToken,
			mockSnapshot.atomicSiteId
		);
		expect( mockLogger.reportStart.mock.calls[ 2 ] ).toEqual( [
			'upload',
			'Uploading archive...',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 2 ] ).toEqual( [ 'Archive uploaded' ] );

		expect( waitForSiteReady ).toHaveBeenCalledWith( mockAtomicSiteId, mockAuthToken.accessToken );
		expect( mockLogger.reportStart.mock.calls[ 3 ] ).toEqual( [
			'ready',
			'Updating preview site...',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 3 ] ).toEqual( [
			`Preview site available at: https://${ mockSiteUrl }`,
		] );

		expect( addPreviewSiteToAppdata ).toHaveBeenCalledWith(
			mockSiteUrl,
			mockAtomicSiteId,
			mockFolder
		);
		expect( mockLogger.reportStart.mock.calls[ 4 ] ).toEqual( [
			'appdata',
			'Saving preview site to Studio...',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 4 ] ).toEqual( [
			'Preview site saved to Studio',
		] );
	} );

	it( 'should use current directory when no folder is specified', async () => {
		const { registerCommand } = await import( '../update' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'studio', 'update', '--host', mockSiteUrl ] );

		expect( validateSiteFolder ).toHaveBeenCalledWith( process.cwd() );
	} );

	it( 'should handle validation errors', async () => {
		const errorMessage = 'Validation failed';
		( validateSiteFolder as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { registerCommand } = await import( '../update' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'studio', 'update', mockFolder, '--host', mockSiteUrl ] );

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

		const { registerCommand } = await import( '../update' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'studio', 'update', mockFolder, '--host', mockSiteUrl ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( createArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle snapshot not found errors', async () => {
		( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [] );

		const { registerCommand } = await import( '../update' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'studio', 'update', mockFolder, '--host', mockSiteUrl ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( createArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle archive creation errors', async () => {
		const errorMessage = 'Archive creation failed';
		( createArchive as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { registerCommand } = await import( '../update' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'studio', 'update', mockFolder, '--host', mockSiteUrl ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( uploadArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle upload errors', async () => {
		const errorMessage = 'Upload failed';
		( uploadArchive as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { registerCommand } = await import( '../update' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'studio', 'update', mockFolder, '--host', mockSiteUrl ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( waitForSiteReady ).not.toHaveBeenCalled();
	} );

	it( 'should handle site readiness errors', async () => {
		const errorMessage = 'Failed to update preview site';
		( waitForSiteReady as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { registerCommand } = await import( '../update' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'studio', 'update', mockFolder, '--host', mockSiteUrl ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( addPreviewSiteToAppdata ).not.toHaveBeenCalled();
	} );

	it( 'should handle appdata errors', async () => {
		const errorMessage = 'Failed to save to appdata';
		( addPreviewSiteToAppdata as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { registerCommand } = await import( '../update' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'studio', 'update', mockFolder, '--host', mockSiteUrl ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );
} );
