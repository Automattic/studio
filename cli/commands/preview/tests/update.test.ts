import os from 'os';
import path from 'path';
import { Archiver } from 'archiver';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { getAuthToken, getSiteByFolder } from 'cli/lib/appdata';
import { archiveSiteContent, cleanup } from 'cli/lib/archive';
import { updateSnapshotInAppdata, getSnapshotsFromAppdata } from 'cli/lib/snapshots';
import { LoggerError } from 'cli/logger';
import { DEMO_SITE_EXPIRATION_DAYS } from 'common/constants';
import { getWordPressVersion } from 'common/lib/get-wordpress-version';
import { vi } from 'vitest';
import { runCommand } from '../update';

vi.mock( 'common/lib/get-wordpress-version' );
vi.mock( 'cli/lib/appdata', async () => {
	const actual = await vi.importActual( 'cli/lib/appdata' );
	return {
		...actual,
		getAppdataDirectory: vi.fn().mockReturnValue( '/test/appdata' ),
		getAuthToken: vi.fn(),
		getSiteByFolder: vi.fn(),
	};
} );
vi.mock( 'cli/lib/archive' );
vi.mock( 'cli/lib/api' );
vi.mock( 'cli/lib/snapshots' );

const mockReportStart = vi.fn();
const mockReportSuccess = vi.fn();
const mockReportError = vi.fn();

vi.mock( 'cli/logger', () => ( {
	Logger: vi.fn( () => ( {
		reportStart: mockReportStart,
		reportSuccess: mockReportSuccess,
		reportError: mockReportError,
	} ) ),
	LoggerError: class LoggerError extends Error {},
} ) );

describe( 'Preview Update Command', () => {
	const mockFolder = '/test/folder';
	const mockBasename = 'folder';
	const mockDate = 1234567890;
	const mockArchivePath = path.join( os.tmpdir(), `${ mockBasename }-${ mockDate }.zip` );
	const mockSiteUrl = 'test-preview.example.com';
	const mockAtomicSiteId = 12345;
	const mockAuthToken = {
		accessToken: 'mock-auth-token',
		id: 123,
		expiresIn: 7200,
		expirationTime: mockDate + 7200000,
		email: 'test@example.com',
		displayName: 'Test User',
	};
	const mockSnapshot = {
		url: mockSiteUrl,
		atomicSiteId: mockAtomicSiteId,
		localSiteId: '456',
		date: Date.now(),
		name: 'Test Snapshot',
		userId: 123,
	};
	const mockArchiver: Partial< Archiver > = {
		on: vi.fn(),
		pipe: vi.fn(),
		directory: vi.fn(),
		file: vi.fn(),
		finalize: vi.fn().mockResolvedValue( undefined ),
	};

	beforeEach( () => {
		vi.clearAllMocks();
		vi.spyOn( Date, 'now' ).mockReturnValue( mockDate );
		vi.spyOn( path, 'basename' ).mockReturnValue( mockBasename );
		vi.spyOn( process, 'cwd' ).mockReturnValue( mockFolder );

		vi.mocked( getAuthToken ).mockResolvedValue( mockAuthToken );
		vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [ mockSnapshot ] );
		vi.mocked( archiveSiteContent ).mockResolvedValue( mockArchiver as Archiver );
		vi.mocked( uploadArchive ).mockResolvedValue( {
			site_url: mockSiteUrl,
			site_id: mockAtomicSiteId,
		} );
		vi.mocked( waitForSiteReady ).mockResolvedValue( true );
		vi.mocked( updateSnapshotInAppdata ).mockResolvedValue( mockSnapshot );
		vi.mocked( getSiteByFolder ).mockResolvedValue( {
			id: mockSnapshot.localSiteId,
			path: mockFolder,
			name: 'Test Site',
			port: 8080,
			phpVersion: '8.0',
		} );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should complete the preview update process successfully', async () => {
		vi.mocked( getWordPressVersion ).mockReturnValue( '6.8.1' );
		await runCommand( mockFolder, mockSiteUrl, false );
		expect( getSiteByFolder ).toHaveBeenCalledWith( mockFolder );
		expect( mockReportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating…' ] );
		expect( mockReportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Validation successful', true ] );

		expect( archiveSiteContent ).toHaveBeenCalledWith( mockFolder, mockArchivePath );
		expect( mockReportStart.mock.calls[ 1 ] ).toEqual( [ 'archive', 'Creating archive…' ] );
		expect( mockReportSuccess.mock.calls[ 1 ] ).toEqual( [ 'Archive created' ] );

		expect( uploadArchive ).toHaveBeenCalledWith(
			mockArchivePath,
			mockAuthToken.accessToken,
			'6.8.1',
			mockSnapshot.atomicSiteId
		);
		expect( mockReportStart.mock.calls[ 2 ] ).toEqual( [ 'upload', 'Uploading archive…' ] );
		expect( mockReportSuccess.mock.calls[ 2 ] ).toEqual( [ 'Archive uploaded' ] );

		expect( waitForSiteReady ).toHaveBeenCalledWith( mockAtomicSiteId, mockAuthToken.accessToken );
		expect( mockReportStart.mock.calls[ 3 ] ).toEqual( [ 'ready', 'Updating preview site…' ] );
		expect( mockReportSuccess.mock.calls[ 3 ] ).toEqual( [
			`Preview site available at: https://${ mockSiteUrl }`,
		] );

		expect( updateSnapshotInAppdata ).toHaveBeenCalledWith( mockAtomicSiteId, mockFolder );
		expect( mockReportStart.mock.calls[ 4 ] ).toEqual( [
			'appdata',
			'Saving preview site to Studio…',
		] );
		expect( mockReportSuccess.mock.calls[ 4 ] ).toEqual( [ 'Preview site saved to Studio' ] );
	} );

	it( 'should use current directory when no folder is specified', async () => {
		await runCommand( process.cwd(), mockSiteUrl, false );

		expect( getSiteByFolder ).toHaveBeenCalledWith( process.cwd() );
	} );

	it( 'should handle authentication errors', async () => {
		const errorMessage =
			'Authentication required. Please run the Studio app and authenticate first.';
		vi.mocked( getAuthToken ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockFolder, mockSiteUrl, false );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( archiveSiteContent ).not.toHaveBeenCalled();
	} );

	it( 'should handle snapshot not found errors', async () => {
		vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [] );

		await runCommand( mockFolder, mockSiteUrl, false );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( archiveSiteContent ).not.toHaveBeenCalled();
	} );

	it( 'should handle archive creation errors', async () => {
		const errorMessage = 'Archive creation failed';
		vi.mocked( archiveSiteContent ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockFolder, mockSiteUrl, false );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( uploadArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle upload errors', async () => {
		const errorMessage = 'Upload failed';
		vi.mocked( uploadArchive ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockFolder, mockSiteUrl, false );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( waitForSiteReady ).not.toHaveBeenCalled();
	} );

	it( 'should handle site readiness errors', async () => {
		const errorMessage = 'Failed to update preview site';
		vi.mocked( waitForSiteReady ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockFolder, mockSiteUrl, false );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( updateSnapshotInAppdata ).not.toHaveBeenCalled();
	} );

	it( 'should handle appdata errors', async () => {
		const errorMessage = 'Failed to save to appdata';
		vi.mocked( updateSnapshotInAppdata ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockFolder, mockSiteUrl, false );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'should always clean up archive file even on error', async () => {
		vi.mocked( uploadArchive ).mockImplementation( () => {
			throw new LoggerError( 'Upload failed' );
		} );

		await runCommand( mockFolder, mockSiteUrl, false );

		expect( cleanup ).toHaveBeenCalledWith( mockArchivePath );
	} );

	it( 'should not allow updating an expired preview site', async () => {
		const expiredDate = mockDate - ( DEMO_SITE_EXPIRATION_DAYS + 1 ) * 24 * 60 * 60 * 1000;
		const expiredSnapshot = { ...mockSnapshot, date: expiredDate };
		vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [ expiredSnapshot ] );

		await runCommand( mockFolder, mockSiteUrl, false );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( archiveSiteContent ).not.toHaveBeenCalled();
	} );

	it( 'should throw error if folder does not match original site and no overwrite flag', async () => {
		vi.mocked( getSiteByFolder ).mockResolvedValueOnce( {
			id: 'different-id',
			path: '/other/path',
			name: 'Other Site',
			port: 8080,
			phpVersion: '8.0',
		} );
		await runCommand( mockFolder, mockSiteUrl, false );
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( archiveSiteContent ).not.toHaveBeenCalled();
	} );

	it( 'should allow update if overwrite flag is set even if folder does not match', async () => {
		vi.mocked( getSiteByFolder ).mockResolvedValueOnce( {
			id: 'different-id',
			path: '/other/path',
			name: 'Other Site',
			port: 8080,
			phpVersion: '8.0',
		} );
		await runCommand( mockFolder, mockSiteUrl, true );
		expect( archiveSiteContent ).toHaveBeenCalledWith( mockFolder, mockArchivePath );
	} );
} );
