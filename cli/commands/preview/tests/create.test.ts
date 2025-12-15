import os from 'os';
import path from 'path';
import { getWordPressVersion } from 'common/lib/get-wordpress-version';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { getAuthToken, getSiteByFolder } from 'cli/lib/appdata';
import { archiveSiteContent, cleanup } from 'cli/lib/archive';
import { saveSnapshotToAppdata } from 'cli/lib/snapshots';
import { Logger, LoggerError } from 'cli/logger';

jest.mock( 'common/lib/get-wordpress-version' );
jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getAppdataDirectory: jest.fn().mockReturnValue( '/test/appdata' ),
	getAuthToken: jest.fn(),
	getSiteByFolder: jest.fn(),
} ) );
jest.mock( 'cli/lib/validation', () => ( {
	validateSiteSize: jest.fn(),
} ) );
jest.mock( 'cli/lib/archive' );
jest.mock( 'cli/lib/api' );
jest.mock( 'cli/lib/snapshots' );
jest.mock( 'cli/logger' );

describe( 'Preview Create Command', () => {
	const mockFolder = '/test/folder';
	const mockBasename = 'folder';
	const mockDate = 1234567890;
	const mockArchivePath = path.join( os.tmpdir(), `${ mockBasename }-${ mockDate }.zip` );
	const mockSiteUrl = 'test-preview.example.com';
	const mockAtomicSiteId = 12345;
	const mockAuthToken = { accessToken: 'mock-auth-token', id: 123 };
	const mockArchiver = {
		on: jest.fn(),
		pipe: jest.fn(),
		directory: jest.fn(),
		file: jest.fn(),
		finalize: jest.fn().mockResolvedValue( undefined ),
	};
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

		mockLogger = {
			reportStart: jest.fn(),
			reportSuccess: jest.fn(),
			reportError: jest.fn(),
		};

		( Logger as jest.Mock ).mockReturnValue( mockLogger );

		( getAuthToken as jest.Mock ).mockResolvedValue( mockAuthToken );
		( getSiteByFolder as jest.Mock ).mockResolvedValue( {
			id: 'site-123',
			path: mockFolder,
			name: 'Test Site',
		} );
		( archiveSiteContent as jest.Mock ).mockResolvedValue( mockArchiver );
		( cleanup as jest.Mock ).mockImplementation( () => {} );
		( uploadArchive as jest.Mock ).mockResolvedValue( {
			site_url: mockSiteUrl,
			site_id: mockAtomicSiteId,
		} );
		( waitForSiteReady as jest.Mock ).mockResolvedValue( true );
		( saveSnapshotToAppdata as jest.Mock ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should complete the preview creation process successfully', async () => {
		( getWordPressVersion as jest.Mock ).mockReturnValue( '6.8.1' );
		const { runCommand } = await import( '../create' );
		await runCommand( mockFolder );

		expect( getSiteByFolder ).toHaveBeenCalledWith( mockFolder );
		expect( mockLogger.reportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating…' ] );
		expect( mockLogger.reportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Validation successful', true ] );

		expect( archiveSiteContent ).toHaveBeenCalledWith( mockFolder, mockArchivePath );
		expect( mockLogger.reportStart.mock.calls[ 1 ] ).toEqual( [ 'archive', 'Creating archive…' ] );
		expect( mockLogger.reportSuccess.mock.calls[ 1 ] ).toEqual( [ 'Archive created' ] );

		expect( uploadArchive ).toHaveBeenCalledWith(
			mockArchivePath,
			mockAuthToken.accessToken,
			'6.8.1'
		);
		expect( mockLogger.reportStart.mock.calls[ 2 ] ).toEqual( [ 'upload', 'Uploading archive…' ] );
		expect( mockLogger.reportSuccess.mock.calls[ 2 ] ).toEqual( [ 'Archive uploaded' ] );

		expect( waitForSiteReady ).toHaveBeenCalledWith( mockAtomicSiteId, mockAuthToken.accessToken );
		expect( mockLogger.reportStart.mock.calls[ 3 ] ).toEqual( [
			'ready',
			'Creating preview site…',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 3 ] ).toEqual( [
			`Preview site available at: https://${ mockSiteUrl }`,
		] );

		expect( saveSnapshotToAppdata ).toHaveBeenCalledWith(
			mockFolder,
			mockAtomicSiteId,
			mockSiteUrl
		);
		expect( mockLogger.reportStart.mock.calls[ 4 ] ).toEqual( [
			'appdata',
			'Saving preview site to Studio…',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 4 ] ).toEqual( [
			'Preview site saved to Studio',
		] );

		expect( cleanup ).toHaveBeenCalledWith( mockArchivePath );
	} );

	it( 'should use current directory when no folder is specified', async () => {
		const { runCommand } = await import( '../create' );
		await runCommand( process.cwd() );

		expect( getSiteByFolder ).toHaveBeenCalledWith( process.cwd() );
	} );

	it( 'should handle errors when folder is not a Studio site', async () => {
		const errorMessage =
			'The specified folder is not added to Studio. Please use `studio site create` to add it first.';
		( getSiteByFolder as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { runCommand } = await import( '../create' );
		await runCommand( mockFolder );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( archiveSiteContent ).not.toHaveBeenCalled();
	} );

	it( 'should handle authentication errors', async () => {
		const errorMessage =
			'Authentication required. Please run the Studio app and authenticate first.';
		( getAuthToken as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { runCommand } = await import( '../create' );
		await runCommand( mockFolder );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( archiveSiteContent ).not.toHaveBeenCalled();
	} );

	it( 'should handle archive creation errors', async () => {
		const errorMessage = 'Archive creation failed';
		( archiveSiteContent as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { runCommand } = await import( '../create' );
		await runCommand( mockFolder );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( uploadArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle upload errors', async () => {
		const errorMessage = 'Upload failed';
		( uploadArchive as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { runCommand } = await import( '../create' );
		await runCommand( mockFolder );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( waitForSiteReady ).not.toHaveBeenCalled();
	} );

	it( 'should handle site readiness errors', async () => {
		const errorMessage = 'Failed to create preview site';
		( waitForSiteReady as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { runCommand } = await import( '../create' );
		await runCommand( mockFolder );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( saveSnapshotToAppdata ).not.toHaveBeenCalled();
	} );

	it( 'should handle appdata errors', async () => {
		const errorMessage = 'Failed to save to appdata';
		( saveSnapshotToAppdata as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { runCommand } = await import( '../create' );
		await runCommand( mockFolder );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'should always clean up archive file even on error', async () => {
		( uploadArchive as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( 'Upload failed' );
		} );

		const { runCommand } = await import( '../create' );
		await runCommand( mockFolder );

		expect( cleanup ).toHaveBeenCalledWith( mockArchivePath );
	} );
} );
