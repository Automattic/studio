import os from 'os';
import path from 'path';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { archiveSiteContent, cleanup } from 'cli/lib/archive';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { saveSnapshotToConfig } from 'cli/lib/snapshots';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { LoggerError } from 'cli/logger';
import { runCommand } from '../create';

// Shared mock functions for Logger
const mockReportStart = vi.fn();
const mockReportSuccess = vi.fn();
const mockReportError = vi.fn();
const mockReportProgress = vi.fn();
const mockReportWarning = vi.fn();
const mockReportKeyValuePair = vi.fn();

vi.mock( '@studio/common/lib/get-wordpress-version' );
vi.mock( import( '@studio/common/lib/shared-config' ), async ( importOriginal ) => ( {
	...( await importOriginal() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( 'cli/lib/cli-config/snapshots', async () => ( {
	...( await vi.importActual( 'cli/lib/cli-config/snapshots' ) ),
	getNextSnapshotSequence: vi.fn().mockReturnValue( 1 ),
} ) );
vi.mock( 'cli/lib/cli-config/sites', async () => ( {
	...( await vi.importActual( 'cli/lib/cli-config/sites' ) ),
	getSiteByFolder: vi.fn(),
} ) );
vi.mock( 'cli/lib/validation', () => ( {
	validateSiteSize: vi.fn(),
} ) );
vi.mock( 'cli/lib/archive' );
vi.mock( 'cli/lib/api' );
vi.mock( 'cli/lib/snapshots', async () => ( {
	...( await vi.importActual( 'cli/lib/snapshots' ) ),
	getSnapshotsFromConfig: vi.fn().mockResolvedValue( [] ),
	saveSnapshotToConfig: vi.fn(),
} ) );
vi.mock( 'cli/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('cli/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );
vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportStart = mockReportStart;
		reportSuccess = mockReportSuccess;
		reportError = mockReportError;
		reportProgress = mockReportProgress;
		reportWarning = mockReportWarning;
		reportKeyValuePair = mockReportKeyValuePair;
		spinner = {};
		currentAction = null;
	},
	LoggerError: class LoggerError extends Error {},
} ) );

describe( 'Preview Create Command', () => {
	const mockFolder = '/test/folder';
	const mockBasename = 'folder';
	const mockDate = 1234567890;
	const mockArchivePath = path.join( os.tmpdir(), `${ mockBasename }-${ mockDate }.zip` );
	const mockSiteUrl = 'test-preview.example.com';
	const mockAtomicSiteId = 12345;
	const mockAuthToken = {
		accessToken: 'mock-auth-token',
		id: 123,
		expiresIn: 3600,
		expirationTime: Date.now() + 3600000,
		email: 'test@example.com',
		displayName: 'Test User',
	};
	const mockArchiver = {
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

		vi.mocked( readAuthToken ).mockResolvedValue( mockAuthToken );
		vi.mocked( getSiteByFolder ).mockResolvedValue( {
			id: 'site-123',
			path: mockFolder,
			name: 'Test Site',
			port: 8080,
			phpVersion: '8.0',
		} );
		vi.mocked( archiveSiteContent, { partial: true } ).mockResolvedValue( mockArchiver );
		vi.mocked( cleanup ).mockResolvedValue( undefined );
		vi.mocked( uploadArchive ).mockResolvedValue( {
			site_url: mockSiteUrl,
			site_id: mockAtomicSiteId,
		} );
		vi.mocked( waitForSiteReady ).mockResolvedValue( true );
		vi.mocked( saveSnapshotToConfig ).mockResolvedValue( {
			url: mockSiteUrl,
			atomicSiteId: mockAtomicSiteId,
			localSiteId: 'site-123',
			date: mockDate,
			name: 'Test Site Preview 1',
			sequence: 1,
			userId: mockAuthToken.id,
		} );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should complete the preview creation process successfully', async () => {
		vi.mocked( getWordPressVersion ).mockReturnValue( '6.8.1' );
		await runCommand( mockFolder );

		expect( getSiteByFolder ).toHaveBeenCalledWith( mockFolder );
		expect( mockReportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating…' ] );

		expect( archiveSiteContent ).toHaveBeenCalledWith( mockFolder, mockArchivePath );
		expect( mockReportStart.mock.calls[ 1 ] ).toEqual( [ 'archive', 'Creating archive…' ] );
		expect( mockReportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Archive created' ] );

		expect( uploadArchive ).toHaveBeenCalledWith(
			mockArchivePath,
			mockAuthToken.accessToken,
			'6.8.1'
		);
		expect( mockReportStart.mock.calls[ 2 ] ).toEqual( [ 'upload', 'Uploading archive…' ] );
		expect( mockReportSuccess.mock.calls[ 1 ] ).toEqual( [ 'Archive uploaded' ] );

		expect( waitForSiteReady ).toHaveBeenCalledWith( mockAtomicSiteId, mockAuthToken.accessToken );
		expect( mockReportStart.mock.calls[ 3 ] ).toEqual( [ 'ready', 'Creating preview site…' ] );
		expect( mockReportSuccess.mock.calls[ 2 ] ).toEqual( [
			`Preview site available at: https://${ mockSiteUrl }`,
		] );

		expect( saveSnapshotToConfig ).toHaveBeenCalledWith(
			mockFolder,
			mockAtomicSiteId,
			mockSiteUrl,
			mockAuthToken.id,
			'Test Site Preview 1'
		);
		expect( mockReportStart.mock.calls[ 4 ] ).toEqual( [
			'appdata',
			'Saving preview site to Studio…',
		] );
		expect( mockReportSuccess.mock.calls[ 3 ] ).toEqual( [ 'Preview site saved to Studio' ] );

		expect( cleanup ).toHaveBeenCalledWith( mockArchivePath );
	} );

	it( 'records a successful preview_site_create Tracks event', async () => {
		await runCommand( mockFolder );

		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.PREVIEW_SITE_CREATE,
			expect.objectContaining( {
				success: true,
				time_ms: expect.any( Number ),
				channel: 'studio-cli',
			} )
		);
	} );

	it( 'records a failed preview_site_create Tracks event with a failure_reason', async () => {
		vi.mocked( uploadArchive ).mockRejectedValue( new LoggerError( 'Failed to upload archive' ) );

		await runCommand( mockFolder );

		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.PREVIEW_SITE_CREATE,
			expect.objectContaining( {
				success: false,
				failure_reason: 'upload',
				time_ms: expect.any( Number ),
				channel: 'studio-cli',
			} )
		);
	} );

	it( 'should use current directory when no folder is specified', async () => {
		await runCommand( process.cwd() );

		expect( getSiteByFolder ).toHaveBeenCalledWith( process.cwd() );
	} );

	it( 'should handle errors when folder is not a Studio site', async () => {
		const errorMessage =
			'The specified folder is not added to Studio. Please use `studio create` to add it first.';
		vi.mocked( getSiteByFolder ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockFolder );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( archiveSiteContent ).not.toHaveBeenCalled();
	} );

	it( 'should handle authentication errors', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( null );

		await runCommand( mockFolder );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( archiveSiteContent ).not.toHaveBeenCalled();
	} );

	it( 'should handle archive creation errors', async () => {
		const errorMessage = 'Archive creation failed';
		vi.mocked( archiveSiteContent ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockFolder );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( uploadArchive ).not.toHaveBeenCalled();
	} );

	it( 'should handle upload errors', async () => {
		const errorMessage = 'Upload failed';
		vi.mocked( uploadArchive ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockFolder );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( waitForSiteReady ).not.toHaveBeenCalled();
	} );

	it( 'should handle site readiness errors', async () => {
		const errorMessage = 'Failed to create preview site';
		vi.mocked( waitForSiteReady ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockFolder );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( saveSnapshotToConfig ).not.toHaveBeenCalled();
	} );

	it( 'should handle appdata errors', async () => {
		const errorMessage = 'Failed to save to appdata';
		vi.mocked( saveSnapshotToConfig ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockFolder );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'should always clean up archive file even on error', async () => {
		vi.mocked( uploadArchive ).mockImplementation( () => {
			throw new LoggerError( 'Upload failed' );
		} );

		await runCommand( mockFolder );

		expect( cleanup ).toHaveBeenCalledWith( mockArchivePath );
	} );
} );
