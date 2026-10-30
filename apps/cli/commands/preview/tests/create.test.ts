import os from 'os';
import path from 'path';
import { isAutomatticianAccount } from '@studio/common/lib/automattician';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { archiveSiteContent, cleanup } from 'cli/lib/archive';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { createPreviewSite, uploadPreviewArchive } from 'cli/lib/preview-sites';
import { withSiteOperation } from 'cli/lib/site-operations';
import { getSnapshotsFromConfig, saveSnapshotToConfig } from 'cli/lib/snapshots';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { LoggerError } from 'cli/logger';
import { runCommand } from '../create';

const mockReportSuccess = vi.fn();
const mockReportError = vi.fn();

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
vi.mock( '@studio/common/lib/automattician', () => ( {
	isAutomatticianAccount: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/get-wordpress-version', () => ( {
	getWordPressVersion: vi.fn().mockReturnValue( '6.8.1' ),
} ) );
vi.mock( 'cli/lib/archive' );
vi.mock( 'cli/lib/api' );
vi.mock( 'cli/lib/preview-sites' );
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
		reportStart = vi.fn();
		reportSuccess = mockReportSuccess;
		reportError = mockReportError;
		reportProgress = vi.fn();
		reportWarning = vi.fn();
		reportResult = vi.fn();
		spinner = {};
		currentAction = null;
	},
	LoggerError: class LoggerError extends Error {},
} ) );

vi.mock( 'cli/lib/site-operations', () => ( {
	withSiteOperation: vi.fn( ( _folder: string, _kind: string, fn: () => unknown ) => fn() ),
} ) );

describe( 'Preview Create Command', () => {
	const mockFolder = '/test/folder';
	const mockBasename = 'folder';
	const mockDate = 1234567890;
	const mockArchivePath = path.join( os.tmpdir(), `${ mockBasename }-${ mockDate }.zip` );
	const mockSiteUrl = 'test-preview.example.com';
	const mockAtomicSiteId = 12345;
	const mockAttachmentId = 678;
	const mockShareUrl = `https://${ mockSiteUrl }/?share=abc123`;
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

		vi.mocked( readAuthToken ).mockResolvedValue( mockAuthToken );
		vi.mocked( isAutomatticianAccount ).mockResolvedValue( true );
		vi.mocked( getSiteByFolder ).mockResolvedValue( {
			id: 'site-123',
			path: mockFolder,
			name: 'Test Site',
			port: 8080,
			phpVersion: '8.0',
		} );
		vi.mocked( archiveSiteContent, { partial: true } ).mockResolvedValue( mockArchiver );
		vi.mocked( cleanup ).mockResolvedValue( undefined );
		vi.mocked( uploadPreviewArchive ).mockResolvedValue( mockAttachmentId );
		vi.mocked( createPreviewSite ).mockResolvedValue( {
			siteId: mockAtomicSiteId,
			hostname: mockSiteUrl,
			shareUrl: mockShareUrl,
		} );
		vi.mocked( saveSnapshotToConfig ).mockResolvedValue( {
			url: mockSiteUrl,
			atomicSiteId: mockAtomicSiteId,
			localSiteId: 'site-123',
			date: mockDate,
			name: 'Test Site Preview 1',
			sequence: 1,
			userId: mockAuthToken.id,
			shareUrl: mockShareUrl,
		} );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should complete the preview creation process successfully', async () => {
		await runCommand( mockFolder );

		expect( withSiteOperation ).toHaveBeenCalledWith(
			mockFolder,
			'export',
			expect.any( Function )
		);
		expect( archiveSiteContent ).toHaveBeenCalledWith( mockFolder, mockArchivePath );
		expect( uploadPreviewArchive ).toHaveBeenCalledWith(
			mockArchivePath,
			mockAuthToken.accessToken
		);
		expect( createPreviewSite ).toHaveBeenCalledWith(
			mockAttachmentId,
			'Test Site Preview 1',
			mockAuthToken.accessToken
		);
		expect( saveSnapshotToConfig ).toHaveBeenCalledWith(
			mockFolder,
			mockAtomicSiteId,
			mockSiteUrl,
			mockAuthToken.id,
			'Test Site Preview 1',
			mockShareUrl
		);
		expect( mockReportSuccess ).toHaveBeenCalledWith(
			`Preview site available at: ${ mockShareUrl }`
		);
		expect( mockReportError ).not.toHaveBeenCalled();
		expect( cleanup ).toHaveBeenCalledWith( mockArchivePath );
	} );

	it( 'creates the preview on Jurassic Ninja for accounts outside the Automattic team', async () => {
		vi.mocked( isAutomatticianAccount ).mockResolvedValue( false );
		vi.mocked( uploadArchive ).mockResolvedValue( {
			site_id: mockAtomicSiteId,
			site_url: 'test-preview.wp.build',
		} );
		vi.mocked( waitForSiteReady ).mockResolvedValue( true );

		await runCommand( mockFolder );

		expect( uploadPreviewArchive ).not.toHaveBeenCalled();
		expect( createPreviewSite ).not.toHaveBeenCalled();
		expect( uploadArchive ).toHaveBeenCalledWith(
			mockArchivePath,
			mockAuthToken.accessToken,
			'6.8.1'
		);
		expect( waitForSiteReady ).toHaveBeenCalledWith( mockAtomicSiteId, mockAuthToken.accessToken );
		expect( saveSnapshotToConfig ).toHaveBeenCalledWith(
			mockFolder,
			mockAtomicSiteId,
			'test-preview.wp.build',
			mockAuthToken.id,
			'Test Site Preview 1',
			undefined
		);
	} );

	it( "records a successful preview_site_create Tracks event with the site's preview count", async () => {
		const preview = ( localSiteId: string, userId: number, date: number ) => ( {
			url: `${ localSiteId }-${ userId }-${ date }.example.com`,
			atomicSiteId: 1,
			localSiteId,
			userId,
			name: 'Preview',
			date,
		} );
		// Counts this user's unexpired previews of this site, the new one included.
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [
			preview( 'site-123', mockAuthToken.id, Date.now() ),
			preview( 'site-123', mockAuthToken.id, Date.now() - 1000 ),
			preview( 'site-123', mockAuthToken.id, 0 ),
			preview( 'other-site', mockAuthToken.id, Date.now() ),
			preview( 'site-123', mockAuthToken.id + 1, Date.now() ),
		] );

		await runCommand( mockFolder );

		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.PREVIEW_SITE_CREATE,
			expect.objectContaining( {
				success: true,
				time_ms: expect.any( Number ),
				site_preview_count: 2,
				channel: 'studio-cli',
			} )
		);
	} );

	it( 'records a failed preview_site_create Tracks event with a failure_reason', async () => {
		vi.mocked( uploadPreviewArchive ).mockRejectedValue(
			new LoggerError( 'Failed to upload archive' )
		);

		await expect( runCommand( mockFolder ) ).rejects.toThrow( LoggerError );

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

	it( 'should handle authentication errors', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( null );

		await expect( runCommand( mockFolder ) ).rejects.toThrow( LoggerError );
		expect( archiveSiteContent ).not.toHaveBeenCalled();
	} );

	it( 'should always clean up archive file even on error', async () => {
		vi.mocked( uploadPreviewArchive ).mockImplementation( () => {
			throw new LoggerError( 'Upload failed' );
		} );

		await expect( runCommand( mockFolder ) ).rejects.toThrow( LoggerError );

		expect( cleanup ).toHaveBeenCalledWith( mockArchivePath );
	} );
} );
