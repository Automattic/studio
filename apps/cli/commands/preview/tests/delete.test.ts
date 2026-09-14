import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { deleteAllSnapshots, deleteSnapshot } from 'cli/lib/api';
import { deleteAllSnapshotsForUserFromConfig } from 'cli/lib/cli-config/snapshots';
import { emitCliEvent } from 'cli/lib/daemon-client';
import {
	getSnapshotsFromConfig,
	deleteSnapshotFromConfig,
	isSnapshotExpired,
} from 'cli/lib/snapshots';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { LoggerError } from 'cli/logger';
import {
	mockReportStart,
	mockReportSuccess,
	mockReportError,
	mockReportProgress,
	mockReportWarning,
	mockReportKeyValuePair,
} from 'cli/tests/test-utils';
import { Mode, runCommand } from '../delete';

vi.mock( import( '@studio/common/lib/shared-config' ), async ( importOriginal ) => ( {
	...( await importOriginal() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( 'cli/lib/api' );
vi.mock( 'cli/lib/cli-config/snapshots' );
vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'cli/lib/snapshots' );
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

describe( 'Preview Delete Command', () => {
	const mockSiteUrl = 'test-preview.example.com';
	const mockAtomicSiteId = 12345;
	const mockAuthToken = {
		accessToken: 'mock-auth-token',
		id: 123,
		expiresIn: 1209600,
		expirationTime: Date.now() + 1209600000,
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

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( readAuthToken ).mockResolvedValue( mockAuthToken );
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [ mockSnapshot ] );
		vi.mocked( deleteAllSnapshots ).mockResolvedValue( undefined );
		vi.mocked( deleteSnapshot ).mockResolvedValue( undefined );
		vi.mocked( deleteAllSnapshotsForUserFromConfig ).mockResolvedValue( undefined );
		vi.mocked( deleteSnapshotFromConfig ).mockResolvedValue( undefined );
		vi.mocked( emitCliEvent ).mockResolvedValue( undefined );
		vi.mocked( isSnapshotExpired ).mockReturnValue( false );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should complete the preview deletion process successfully', async () => {
		await runCommand( Mode.DELETE_SINGLE_SNAPSHOT, mockSiteUrl );

		expect( readAuthToken ).toHaveBeenCalled();
		expect( getSnapshotsFromConfig ).toHaveBeenCalledWith( mockAuthToken.id );
		expect( deleteSnapshot ).toHaveBeenCalledWith( mockAtomicSiteId, mockAuthToken.accessToken );
		expect( deleteSnapshotFromConfig ).toHaveBeenCalledWith( mockSiteUrl );
		expect( emitCliEvent ).toHaveBeenCalledWith( {
			event: SNAPSHOT_EVENTS.DELETED,
			data: { snapshotUrl: mockSiteUrl },
		} );

		expect( mockReportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating…' ] );
		expect( mockReportStart.mock.calls[ 1 ] ).toEqual( [ 'delete', 'Deleting…' ] );
		expect( mockReportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Deletion successful' ] );

		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.PREVIEW_SITE_DELETE,
			expect.objectContaining( { channel: 'studio-cli' } )
		);
	} );

	it( 'should handle authentication errors', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( null );

		await runCommand( Mode.DELETE_SINGLE_SNAPSHOT, mockSiteUrl );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( deleteSnapshot ).not.toHaveBeenCalled();
	} );

	it( 'should handle snapshot not found errors', async () => {
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );

		await runCommand( Mode.DELETE_SINGLE_SNAPSHOT, mockSiteUrl );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( deleteSnapshot ).not.toHaveBeenCalled();
	} );

	it( 'should skip the API call and succeed when the snapshot is expired', async () => {
		vi.mocked( isSnapshotExpired ).mockReturnValue( true );

		await runCommand( Mode.DELETE_SINGLE_SNAPSHOT, mockSiteUrl );

		expect( deleteSnapshot ).not.toHaveBeenCalled();
		expect( deleteSnapshotFromConfig ).toHaveBeenCalledWith( mockSiteUrl );
		expect( emitCliEvent ).toHaveBeenCalledWith( {
			event: SNAPSHOT_EVENTS.DELETED,
			data: { snapshotUrl: mockSiteUrl },
		} );
		expect( mockReportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Deletion successful' ] );
	} );

	it( 'should handle delete preview site errors', async () => {
		const errorMessage = 'Failed to delete preview site';
		vi.mocked( deleteSnapshot ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( Mode.DELETE_SINGLE_SNAPSHOT, mockSiteUrl );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( deleteSnapshotFromConfig ).not.toHaveBeenCalled();
	} );

	it( 'should handle delete snapshot errors', async () => {
		const errorMessage = 'Failed to delete snapshot';
		vi.mocked( deleteSnapshotFromConfig ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( Mode.DELETE_SINGLE_SNAPSHOT, mockSiteUrl );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'should complete deleting all preview sites successfully', async () => {
		await runCommand( Mode.DELETE_ALL_SNAPSHOT, undefined );

		expect( readAuthToken ).toHaveBeenCalled();
		expect( deleteAllSnapshots ).toHaveBeenCalledWith( mockAuthToken.accessToken );
		expect( deleteAllSnapshotsForUserFromConfig ).toHaveBeenCalledWith( mockAuthToken.id );
		expect( emitCliEvent ).toHaveBeenCalledWith( { event: SNAPSHOT_EVENTS.DELETED_ALL } );
		expect( deleteSnapshot ).not.toHaveBeenCalled();
		expect( deleteSnapshotFromConfig ).not.toHaveBeenCalled();

		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.PREVIEW_SITE_DELETE_ALL,
			expect.objectContaining( { count: 1, channel: 'studio-cli' } )
		);
	} );

	it( 'should handle delete all preview sites errors', async () => {
		const errorMessage = 'Failed to delete all preview sites';
		vi.mocked( deleteAllSnapshots ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( Mode.DELETE_ALL_SNAPSHOT, undefined );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( deleteAllSnapshotsForUserFromConfig ).not.toHaveBeenCalled();
	} );
} );
