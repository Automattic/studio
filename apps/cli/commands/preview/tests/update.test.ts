import os from 'os';
import path from 'path';
import { DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { readAuthToken } from '@studio/common/lib/shared-config';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import { Archiver } from 'archiver';
import { vi } from 'vitest';
import { archiveSiteContent, cleanup } from 'cli/lib/archive';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import {
	createPreviewSite,
	deleteSnapshotSite,
	updatePreviewSite,
	uploadPreviewArchive,
} from 'cli/lib/preview-sites';
import { getSiteTracksProps } from 'cli/lib/site-tracks';
import {
	deleteSnapshotFromConfig,
	getSnapshotsFromConfig,
	saveSnapshotToConfig,
	updateSnapshotInConfig,
} from 'cli/lib/snapshots';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { LoggerError } from 'cli/logger';
import { mockReportSuccess, mockReportError } from 'cli/tests/test-utils';
import { runCommand as createPreview } from '../create';
import { runCommand } from '../update';

vi.mock( '@studio/common/lib/wpcom-factory' );

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
vi.mock( 'cli/lib/site-tracks' );
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
		reportWarning = vi.fn();
	},
	LoggerError: class LoggerError extends Error {},
} ) );

vi.mock( 'cli/lib/site-versions', () => ( {
	getSiteVersion: vi.fn().mockResolvedValue( 'version-1' ),
} ) );
vi.mock( 'cli/lib/site-operations', () => ( {
	withSiteOperation: vi.fn( ( _folder: string, _kind: string, fn: () => unknown ) => fn() ),
} ) );

describe( 'Preview Update Command', () => {
	const mockFolder = '/test/folder';
	const mockBasename = 'folder';
	const mockDate = 1234567890;
	const mockArchivePath = path.join( os.tmpdir(), `${ mockBasename }-${ mockDate }.zip` );
	const mockSiteUrl = 'test-preview.wpcomstaging.com';
	const mockShareUrl = `https://${ mockSiteUrl }/?share=abc123`;
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
		shareUrl: mockShareUrl,
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
		vi.mocked( getSiteTracksProps ).mockImplementation( async ( _folder, preview ) => ( {
			site_id: 'b4bfb381-cbf4-4003-b3db-233bcda55f51',
			...( preview ? { preview_id: '603537e6-95ed-4583-84c2-d2725af37d8a' } : {} ),
		} ) );
		vi.spyOn( Date, 'now' ).mockReturnValue( mockDate );
		vi.spyOn( path, 'basename' ).mockReturnValue( mockBasename );

		vi.mocked( readAuthToken ).mockResolvedValue( mockAuthToken );
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [ mockSnapshot ] );
		vi.mocked( archiveSiteContent ).mockResolvedValue( mockArchiver as Archiver );
		vi.mocked( uploadPreviewArchive ).mockResolvedValue( 678 );
		vi.mocked( updatePreviewSite ).mockResolvedValue( {
			siteId: mockAtomicSiteId,
			hostname: mockSiteUrl,
			shareUrl: mockShareUrl,
			liveSiteId: 777,
		} );
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

	it.each( [ 'create', 'update', 'move' ] as const )(
		'sends the local site origin in the %s request',
		async ( operation ) => {
			const actual =
				await vi.importActual< typeof import('cli/lib/preview-sites') >( 'cli/lib/preview-sites' );
			if ( operation === 'update' ) {
				vi.mocked( updatePreviewSite ).mockImplementationOnce( actual.updatePreviewSite );
			} else {
				vi.mocked( createPreviewSite ).mockImplementationOnce( actual.createPreviewSite );
			}
			let importCount = 0;
			const post = vi.fn().mockResolvedValue( {
				blog_details: { blogid: mockAtomicSiteId },
			} );
			vi.mocked( wpcomFactory ).mockReturnValue( {
				req: {
					post,
					get: vi.fn( async ( { path }: { path: string } ) =>
						path === '/wow-funnel/pending'
							? { preview_sites: [ { blog_id: mockAtomicSiteId, share_url: mockShareUrl } ] }
							: { importId: String( ++importCount ), importStatus: 'importSuccess' }
					),
				},
			} as unknown as ReturnType< typeof wpcomFactory > );
			vi.mocked( saveSnapshotToConfig ).mockResolvedValue( mockSnapshot );

			if ( operation === 'create' ) {
				await createPreview( mockFolder, 'Preview' );
			} else {
				const host = operation === 'move' ? 'old-preview.wp.build' : mockSiteUrl;
				vi.mocked( getSnapshotsFromConfig ).mockResolvedValueOnce( [
					{ ...mockSnapshot, url: host },
				] );
				await runCommand( mockFolder, host, false );
			}

			expect( post ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path:
						operation === 'update'
							? `/sites/${ mockAtomicSiteId }/wow-funnel/update`
							: '/sites/new',
					body: expect.objectContaining(
						operation === 'update'
							? { args: { attachment_id: '678', origin_id: mockSnapshot.localSiteId } }
							: {
									options: expect.objectContaining( {
										wow_funnel_args: { attachment_id: '678', origin_id: mockSnapshot.localSiteId },
									} ),
							  }
					),
				} )
			);
		}
	);

	it( 'updates a WordPress.com preview through the preview funnel', async () => {
		await runCommand( mockFolder, mockSiteUrl, false );

		expect( archiveSiteContent ).toHaveBeenCalledWith( mockFolder, mockArchivePath, {
			onWpcom: true,
		} );
		expect( uploadPreviewArchive ).toHaveBeenCalledWith(
			mockArchivePath,
			mockAuthToken.accessToken,
			mockAtomicSiteId
		);
		expect( updatePreviewSite ).toHaveBeenCalledWith(
			mockAtomicSiteId,
			678,
			mockAuthToken.accessToken,
			undefined,
			mockSnapshot.localSiteId
		);
		expect( createPreviewSite ).not.toHaveBeenCalled();
		expect( updateSnapshotInConfig ).toHaveBeenCalledWith(
			mockAtomicSiteId,
			mockFolder,
			mockShareUrl,
			'version-1',
			777
		);
		expect( mockReportSuccess ).toHaveBeenCalledWith(
			`Preview site available at: ${ mockShareUrl }`
		);
	} );

	it.each( [
		[ 'deletes the old site', undefined ],
		[ 'keeps the new preview when deleting the old site fails', new Error( 'delete failed' ) ],
	] )( 'moves a Jurassic Ninja preview to WordPress.com and %s', async ( _label, deleteError ) => {
		const jurassicNinjaHost = 'test-preview.wp.build';
		const jurassicNinjaSnapshot = { ...mockSnapshot, url: jurassicNinjaHost, shareUrl: undefined };
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [ jurassicNinjaSnapshot ] );
		const newHost = 'new-preview.wpcomstaging.com';
		const shareUrl = `https://${ newHost }/?share=abc123`;
		const newSnapshot = {
			...mockSnapshot,
			url: newHost,
			atomicSiteId: 999,
			shareUrl,
		};
		vi.mocked( createPreviewSite ).mockResolvedValue( {
			siteId: 999,
			hostname: newHost,
			shareUrl,
			liveSiteId: 777,
		} );
		vi.mocked( saveSnapshotToConfig ).mockResolvedValue( newSnapshot );
		if ( deleteError ) {
			vi.mocked( deleteSnapshotSite ).mockRejectedValue( deleteError );
		}

		const result = await runCommand( mockFolder, jurassicNinjaHost, false );

		expect( archiveSiteContent ).toHaveBeenCalledWith( mockFolder, mockArchivePath, {
			onWpcom: true,
		} );
		expect( createPreviewSite ).toHaveBeenCalledWith(
			678,
			mockSnapshot.name,
			mockAuthToken.accessToken,
			undefined,
			mockSnapshot.localSiteId
		);
		expect( updatePreviewSite ).not.toHaveBeenCalled();
		expect( updateSnapshotInConfig ).not.toHaveBeenCalled();
		expect( saveSnapshotToConfig ).toHaveBeenCalledWith(
			mockFolder,
			999,
			newHost,
			mockAuthToken.id,
			mockSnapshot.name,
			shareUrl,
			'version-1',
			777
		);
		expect( deleteSnapshotFromConfig ).toHaveBeenCalledWith( jurassicNinjaHost );
		expect( deleteSnapshotSite ).toHaveBeenCalledWith(
			jurassicNinjaSnapshot,
			mockAuthToken.accessToken
		);
		expect( mockReportSuccess ).toHaveBeenCalledWith( expect.stringContaining( 'link changed' ) );
		expect( mockReportSuccess ).toHaveBeenCalledWith( expect.stringContaining( shareUrl ) );
		expect( result ).toBe( newSnapshot );
		expect( mockReportError ).not.toHaveBeenCalled();
	} );

	it( 'records a successful preview_site_update Tracks event', async () => {
		await runCommand( mockFolder, mockSiteUrl, false );

		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.PREVIEW_SITE_UPDATE,
			expect.objectContaining( {
				success: true,
				site_id: 'b4bfb381-cbf4-4003-b3db-233bcda55f51',
				preview_id: '603537e6-95ed-4583-84c2-d2725af37d8a',
				time_ms: expect.any( Number ),
				channel: 'studio-cli',
			} )
		);
	} );

	it( 'includes resolved IDs on an update failure', async () => {
		vi.mocked( uploadPreviewArchive ).mockRejectedValueOnce( new Error( 'Upload failed' ) );
		await expect( runCommand( mockFolder, mockSiteUrl, false ) ).rejects.toThrow();
		expect( getSiteTracksProps ).toHaveBeenCalledWith( mockFolder, mockSnapshot );
		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.PREVIEW_SITE_UPDATE,
			expect.objectContaining( {
				success: false,
				site_id: 'b4bfb381-cbf4-4003-b3db-233bcda55f51',
				preview_id: '603537e6-95ed-4583-84c2-d2725af37d8a',
			} )
		);
	} );

	it( 'omits preview context when the preview cannot be resolved', async () => {
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValueOnce( [] );
		await expect( runCommand( mockFolder, mockSiteUrl, false ) ).rejects.toThrow();
		expect( getSiteTracksProps ).toHaveBeenCalledWith( mockFolder, undefined );
		const props = vi
			.mocked( recordTracksEvent )
			.mock.calls.find( ( [ event ] ) => event === TRACKS_EVENTS.PREVIEW_SITE_UPDATE )?.[ 1 ];
		expect( props ).not.toHaveProperty( 'preview_id' );
	} );

	it( 'preserves a successful operation and its event when ID storage is unavailable', async () => {
		vi.mocked( getSiteTracksProps ).mockResolvedValueOnce( {} );
		await runCommand( mockFolder, mockSiteUrl, false );
		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.PREVIEW_SITE_UPDATE,
			expect.objectContaining( { success: true, channel: 'studio-cli' } )
		);
	} );

	it( 'records a failed preview_site_update Tracks event with a failure_reason', async () => {
		vi.mocked( uploadPreviewArchive ).mockRejectedValue(
			new LoggerError( 'Failed to upload archive' )
		);

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
		vi.mocked( uploadPreviewArchive ).mockImplementation( () => {
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
		expect( updatePreviewSite ).toHaveBeenCalled();
	} );
} );
