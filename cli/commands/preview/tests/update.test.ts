import os from 'os';
import path from 'path';
import { DEMO_SITE_EXPIRATION_DAYS } from 'common/constants';
import { getWordPressVersion } from 'common/lib/get-wordpress-version';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { getAuthToken, getOrCreateSiteByFolder, getSiteByFolder } from 'cli/lib/appdata';
import { archiveSiteContent, cleanup } from 'cli/lib/archive';
import { updateSnapshotInAppdata, getSnapshotsFromAppdata } from 'cli/lib/snapshots';
import { validateSiteFolder } from 'cli/lib/validation';
import { Logger, LoggerError } from 'cli/logger';

jest.mock( 'common/lib/get-wordpress-version' );
jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getAppdataDirectory: jest.fn().mockReturnValue( '/test/appdata' ),
	getAuthToken: jest.fn(),
	getSiteByFolder: jest.fn(),
	getOrCreateSiteByFolder: jest.fn(),
} ) );
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
		( validateSiteFolder as jest.Mock ).mockReturnValue( true );
		( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [ mockSnapshot ] );
		( archiveSiteContent as jest.Mock ).mockResolvedValue( undefined );
		( uploadArchive as jest.Mock ).mockResolvedValue( {
			site_url: mockSiteUrl,
			site_id: mockAtomicSiteId,
		} );
		( waitForSiteReady as jest.Mock ).mockResolvedValue( true );
		( updateSnapshotInAppdata as jest.Mock ).mockResolvedValue( undefined );
		( getSiteByFolder as jest.Mock ).mockResolvedValue( {
			id: mockSnapshot.localSiteId,
			path: mockFolder,
			name: 'Test Site',
		} );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should complete the preview update process successfully', async () => {
		( getWordPressVersion as jest.Mock ).mockReturnValue( '6.8.1' );
		const { runCommand } = await import( '../update' );
		await runCommand( mockFolder, mockSiteUrl, false );
		expect( validateSiteFolder ).toHaveBeenCalledWith( mockFolder );
		expect( mockLogger.reportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating…' ] );
		expect( mockLogger.reportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Validation successful', true ] );

		expect( archiveSiteContent ).toHaveBeenCalledWith( mockFolder, mockArchivePath );
		expect( mockLogger.reportStart.mock.calls[ 1 ] ).toEqual( [ 'archive', 'Creating archive…' ] );
		expect( mockLogger.reportSuccess.mock.calls[ 1 ] ).toEqual( [ 'Archive created' ] );

		expect( uploadArchive ).toHaveBeenCalledWith(
			mockArchivePath,
			mockAuthToken.accessToken,
			'6.8.1',
			mockSnapshot.atomicSiteId
		);
		expect( mockLogger.reportStart.mock.calls[ 2 ] ).toEqual( [ 'upload', 'Uploading archive…' ] );
		expect( mockLogger.reportSuccess.mock.calls[ 2 ] ).toEqual( [ 'Archive uploaded' ] );

		expect( waitForSiteReady ).toHaveBeenCalledWith( mockAtomicSiteId, mockAuthToken.accessToken );
		expect( mockLogger.reportStart.mock.calls[ 3 ] ).toEqual( [
			'ready',
			'Updating preview site…',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 3 ] ).toEqual( [
			`Preview site available at: https://${ mockSiteUrl }`,
		] );

		expect( updateSnapshotInAppdata ).toHaveBeenCalledWith( mockAtomicSiteId, mockFolder );
		expect( mockLogger.reportStart.mock.calls[ 4 ] ).toEqual( [
			'appdata',
			'Saving preview site to Studio…',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 4 ] ).toEqual( [
			'Preview site saved to Studio',
		] );
	} );

	it( 'should use current directory when no folder is specified', async () => {
		const { runCommand } = await import( '../update' );
		await runCommand( process.cwd(), mockSiteUrl, false );

		expect( validateSiteFolder ).toHaveBeenCalledWith( process.cwd() );
	} );

	it( 'should handle validation errors', async () => {
		const errorMessage = 'Validation failed';
		( validateSiteFolder as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { runCommand } = await import( '../update' );
		await runCommand( mockFolder, mockSiteUrl, false );

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

		const { runCommand } = await import( '../update' );
		await runCommand( mockFolder, mockSiteUrl, false );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( archiveSiteContent ).not.toHaveBeenCalled();
	} );

	it( 'should handle snapshot not found errors', async () => {
		( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [] );

		const { runCommand } = await import( '../update' );
		await runCommand( mockFolder, mockSiteUrl, false );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( archiveSiteContent ).not.toHaveBeenCalled();
	} );

	it( 'should handle archive creation errors', async () => {
		const errorMessage = 'Archive creation failed';
		( archiveSiteContent as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { runCommand } = await import( '../update' );
		await runCommand( mockFolder, mockSiteUrl, false );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( uploadArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle upload errors', async () => {
		const errorMessage = 'Upload failed';
		( uploadArchive as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { runCommand } = await import( '../update' );
		await runCommand( mockFolder, mockSiteUrl, false );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( waitForSiteReady ).not.toHaveBeenCalled();
	} );

	it( 'should handle site readiness errors', async () => {
		const errorMessage = 'Failed to update preview site';
		( waitForSiteReady as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { runCommand } = await import( '../update' );
		await runCommand( mockFolder, mockSiteUrl, false );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( updateSnapshotInAppdata ).not.toHaveBeenCalled();
	} );

	it( 'should handle appdata errors', async () => {
		const errorMessage = 'Failed to save to appdata';
		( updateSnapshotInAppdata as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		const { runCommand } = await import( '../update' );
		await runCommand( mockFolder, mockSiteUrl, false );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'should always clean up archive file even on error', async () => {
		( uploadArchive as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( 'Upload failed' );
		} );

		const { runCommand } = await import( '../update' );
		await runCommand( mockFolder, mockSiteUrl, false );

		expect( cleanup ).toHaveBeenCalledWith( mockArchivePath );
	} );

	it( 'should not allow updating an expired preview site', async () => {
		const { runCommand } = await import( '../update' );
		const expiredDate = mockDate - ( DEMO_SITE_EXPIRATION_DAYS + 1 ) * 24 * 60 * 60 * 1000;
		const expiredSnapshot = { ...mockSnapshot, date: expiredDate };
		( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [ expiredSnapshot ] );

		await runCommand( mockFolder, mockSiteUrl, false );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( archiveSiteContent ).not.toHaveBeenCalled();
	} );

	it( 'should throw error if folder does not match original site and no overwrite flag', async () => {
		const { runCommand } = await import( '../update' );
		( getSiteByFolder as jest.Mock ).mockResolvedValueOnce( {
			id: 'different-id',
			path: '/other/path',
			name: 'Other Site',
		} );
		await runCommand( mockFolder, mockSiteUrl, false );
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( archiveSiteContent ).not.toHaveBeenCalled();
	} );

	it( 'should allow update if overwrite flag is set even if folder does not match', async () => {
		const { runCommand } = await import( '../update' );
		( getOrCreateSiteByFolder as jest.Mock ).mockResolvedValueOnce( {
			id: 'different-id',
			path: '/other/path',
			name: 'Other Site',
		} );
		await runCommand( mockFolder, mockSiteUrl, true );
		expect( archiveSiteContent ).toHaveBeenCalledWith( mockFolder, mockArchivePath );
	} );
} );
