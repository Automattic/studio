import os from 'os';
import path from 'path';
import { DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { Archiver } from 'archiver';
import { vi } from 'vitest';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { archiveSiteContent, cleanup } from 'cli/lib/archive';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { updatePreviewSite, uploadPreviewArchive } from 'cli/lib/preview-sites';
import { withSiteOperation } from 'cli/lib/site-operations';
import { updateSnapshotInConfig, getSnapshotsFromConfig } from 'cli/lib/snapshots';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { LoggerError } from 'cli/logger';
import { mockReportSuccess, mockReportError } from 'cli/tests/test-utils';
import { runCommand } from '../update';

vi.mock( '@studio/common/lib/get-wordpress-version' );
vi.mock( import( '@studio/common/lib/shared-config' ), async ( importOriginal ) => ( {
	...( await importOriginal() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( 'cli/lib/cli-config/sites', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/sites' );
	return {
		...actual,
		getSiteByFolder: vi.fn(),
	};
} );
vi.mock( 'cli/lib/archive' );
vi.mock( 'cli/lib/api' );
vi.mock( 'cli/lib/preview-sites' );
vi.mock( 'cli/lib/snapshots' );
vi.mock( 'cli/lib/validation', () => ( {
	validateSiteSize: vi.fn(),
} ) );
vi.mock( 'cli/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('cli/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );

vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportStart = vi.fn();
		reportSuccess = mockReportSuccess;
		reportError = mockReportError;
		reportResult = vi.fn();
	},
	LoggerError: class LoggerError extends Error {},
} ) );

vi.mock( 'cli/lib/site-operations', () => ( {
	withSiteOperation: vi.fn( ( _folder: string, _kind: string, fn: () => unknown ) => fn() ),
} ) );

describe( 'Preview Update Command', () => {
	const mockFolder = '/test/folder';
	const mockBasename = 'folder';
	const mockDate = 1234567890;
	const mockArchivePath = path.join( os.tmpdir(), `${ mockBasename }-${ mockDate }.zip` );
	const mockSiteUrl = 'test-preview.wp.build';
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

		vi.mocked( readAuthToken ).mockResolvedValue( mockAuthToken );
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [ mockSnapshot ] );
		vi.mocked( archiveSiteContent ).mockResolvedValue( mockArchiver as Archiver );
		vi.mocked( uploadArchive ).mockResolvedValue( {
			site_url: mockSiteUrl,
			site_id: mockAtomicSiteId,
		} );
		vi.mocked( waitForSiteReady ).mockResolvedValue( true );
		vi.mocked( updateSnapshotInConfig ).mockResolvedValue( mockSnapshot );
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

	it( 'updates a WordPress.com preview through the preview funnel', async () => {
		const wpcomHost = 'test-preview.wpcomstaging.com';
		const shareUrl = `https://${ wpcomHost }/?share=abc123`;
		const wpcomSnapshot = { ...mockSnapshot, url: wpcomHost, shareUrl };
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [ wpcomSnapshot ] );
		vi.mocked( updateSnapshotInConfig ).mockResolvedValue( wpcomSnapshot );
		vi.mocked( uploadPreviewArchive ).mockResolvedValue( 678 );
		vi.mocked( updatePreviewSite ).mockResolvedValue( {
			siteId: mockAtomicSiteId,
			hostname: wpcomHost,
			shareUrl,
		} );

		await runCommand( mockFolder, wpcomHost, false );

		expect( uploadPreviewArchive ).toHaveBeenCalledWith(
			mockArchivePath,
			mockAuthToken.accessToken,
			mockAtomicSiteId
		);
		expect( updatePreviewSite ).toHaveBeenCalledWith(
			mockAtomicSiteId,
			678,
			mockAuthToken.accessToken
		);
		expect( uploadArchive ).not.toHaveBeenCalled();
		expect( updateSnapshotInConfig ).toHaveBeenCalledWith( mockAtomicSiteId, mockFolder, shareUrl );
		expect( mockReportSuccess ).toHaveBeenCalledWith( `Preview site available at: ${ shareUrl }` );
	} );

	it( 'updates a Jurassic Ninja preview', async () => {
		vi.mocked( getWordPressVersion ).mockReturnValue( '6.8.1' );
		await runCommand( mockFolder, mockSiteUrl, false );

		expect( withSiteOperation ).toHaveBeenCalledWith(
			mockFolder,
			'export',
			expect.any( Function )
		);
		expect( archiveSiteContent ).toHaveBeenCalledWith( mockFolder, mockArchivePath );
		expect( uploadArchive ).toHaveBeenCalledWith(
			mockArchivePath,
			mockAuthToken.accessToken,
			'6.8.1',
			mockSnapshot.atomicSiteId
		);
		expect( waitForSiteReady ).toHaveBeenCalledWith( mockAtomicSiteId, mockAuthToken.accessToken );
		expect( updateSnapshotInConfig ).toHaveBeenCalledWith(
			mockAtomicSiteId,
			mockFolder,
			undefined
		);
		expect( mockReportSuccess ).toHaveBeenCalledWith(
			`Preview site available at: https://${ mockSiteUrl }`
		);
		expect( mockReportError ).not.toHaveBeenCalled();
	} );

	it( 'records a successful preview_site_update Tracks event', async () => {
		await runCommand( mockFolder, mockSiteUrl, false );

		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.PREVIEW_SITE_UPDATE,
			expect.objectContaining( {
				success: true,
				time_ms: expect.any( Number ),
				channel: 'studio-cli',
			} )
		);
	} );

	it( 'records a failed preview_site_update Tracks event with a failure_reason', async () => {
		vi.mocked( uploadArchive ).mockRejectedValue( new LoggerError( 'Failed to upload archive' ) );

		await expect( runCommand( mockFolder, mockSiteUrl, false ) ).rejects.toThrow( LoggerError );

		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.PREVIEW_SITE_UPDATE,
			expect.objectContaining( {
				success: false,
				failure_reason: 'upload',
				time_ms: expect.any( Number ),
				channel: 'studio-cli',
			} )
		);
	} );

	it( 'should handle authentication errors', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( null );

		await expect( runCommand( mockFolder, mockSiteUrl, false ) ).rejects.toThrow( LoggerError );
		expect( archiveSiteContent ).not.toHaveBeenCalled();
	} );

	it( 'should handle snapshot not found errors', async () => {
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );

		await expect( runCommand( mockFolder, mockSiteUrl, false ) ).rejects.toThrow( LoggerError );
		expect( archiveSiteContent ).not.toHaveBeenCalled();
	} );

	it( 'should always clean up archive file even on error', async () => {
		vi.mocked( uploadArchive ).mockImplementation( () => {
			throw new LoggerError( 'Upload failed' );
		} );

		await expect( runCommand( mockFolder, mockSiteUrl, false ) ).rejects.toThrow( LoggerError );

		expect( cleanup ).toHaveBeenCalledWith( mockArchivePath );
	} );

	it( 'should not allow updating an expired preview site', async () => {
		const expiredDate = mockDate - ( DEMO_SITE_EXPIRATION_DAYS + 1 ) * 24 * 60 * 60 * 1000;
		const expiredSnapshot = { ...mockSnapshot, date: expiredDate };
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [ expiredSnapshot ] );

		await expect( runCommand( mockFolder, mockSiteUrl, false ) ).rejects.toThrow( LoggerError );
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
		await expect( runCommand( mockFolder, mockSiteUrl, false ) ).rejects.toThrow( LoggerError );
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
