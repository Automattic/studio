import { vi } from 'vitest';
import { deleteSnapshot } from 'cli/lib/api';
import { getAuthToken } from 'cli/lib/appdata';
import { getSnapshotsFromAppdata, deleteSnapshotFromAppdata } from 'cli/lib/snapshots';
import { LoggerError } from 'cli/logger';
import {
	mockReportStart,
	mockReportSuccess,
	mockReportError,
	mockReportProgress,
	mockReportWarning,
	mockReportKeyValuePair,
} from 'cli/tests/test-utils';
import { runCommand } from '../delete';

vi.mock( 'cli/lib/appdata', async () => {
	const actual = await vi.importActual( 'cli/lib/appdata' );
	return {
		...actual,
		getAppdataDirectory: vi.fn().mockReturnValue( '/test/appdata' ),
		getAuthToken: vi.fn(),
	};
} );
vi.mock( 'cli/lib/api' );
vi.mock( 'cli/lib/snapshots' );
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

		vi.mocked( getAuthToken ).mockResolvedValue( mockAuthToken );
		vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [ mockSnapshot ] );
		vi.mocked( deleteSnapshot ).mockResolvedValue( undefined );
		vi.mocked( deleteSnapshotFromAppdata ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should complete the preview deletion process successfully', async () => {
		await runCommand( mockSiteUrl );

		expect( getAuthToken ).toHaveBeenCalled();
		expect( getSnapshotsFromAppdata ).toHaveBeenCalledWith( mockAuthToken.id );
		expect( deleteSnapshot ).toHaveBeenCalledWith( mockAtomicSiteId, mockAuthToken.accessToken );
		expect( deleteSnapshotFromAppdata ).toHaveBeenCalledWith( mockSiteUrl );

		expect( mockReportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating…' ] );
		expect( mockReportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Validation successful', true ] );
		expect( mockReportStart.mock.calls[ 1 ] ).toEqual( [ 'delete', 'Deleting…' ] );
		expect( mockReportSuccess.mock.calls[ 1 ] ).toEqual( [ 'Deletion successful' ] );
	} );

	it( 'should handle authentication errors', async () => {
		const errorMessage =
			'Authentication required. Please run the Studio app and authenticate first.';
		vi.mocked( getAuthToken ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockSiteUrl );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( deleteSnapshot ).not.toHaveBeenCalled();
	} );

	it( 'should handle snapshot not found errors', async () => {
		vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [] );

		await runCommand( mockSiteUrl );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( deleteSnapshot ).not.toHaveBeenCalled();
	} );

	it( 'should handle delete preview site errors', async () => {
		const errorMessage = 'Failed to delete preview site';
		vi.mocked( deleteSnapshot ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockSiteUrl );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( deleteSnapshotFromAppdata ).not.toHaveBeenCalled();
	} );

	it( 'should handle delete snapshot errors', async () => {
		const errorMessage = 'Failed to delete snapshot';
		vi.mocked( deleteSnapshotFromAppdata ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockSiteUrl );

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );
} );
