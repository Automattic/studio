import { deleteSnapshot } from 'cli/lib/api';
import { getAuthToken } from 'cli/lib/appdata';
import { getSnapshotsFromAppdata, deleteSnapshotFromAppdata } from 'cli/lib/snapshots';
import { Logger, LoggerError } from 'cli/logger';
import { runCommand } from '../delete';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getAppdataDirectory: jest.fn().mockReturnValue( '/test/appdata' ),
	getAuthToken: jest.fn(),
} ) );
jest.mock( 'cli/lib/api' );
jest.mock( 'cli/lib/snapshots' );
jest.mock( 'cli/logger' );

describe( 'Preview Delete Command', () => {
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

		mockLogger = {
			reportStart: jest.fn(),
			reportSuccess: jest.fn(),
			reportError: jest.fn(),
		};

		( Logger as jest.Mock ).mockReturnValue( mockLogger );
		( getAuthToken as jest.Mock ).mockResolvedValue( mockAuthToken );
		( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [ mockSnapshot ] );
		( deleteSnapshot as jest.Mock ).mockResolvedValue( undefined );
		( deleteSnapshotFromAppdata as jest.Mock ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should complete the preview deletion process successfully', async () => {
		await runCommand( mockSiteUrl );

		expect( getAuthToken ).toHaveBeenCalled();
		expect( getSnapshotsFromAppdata ).toHaveBeenCalledWith( mockAuthToken.id );
		expect( deleteSnapshot ).toHaveBeenCalledWith( mockAtomicSiteId, mockAuthToken.accessToken );
		expect( deleteSnapshotFromAppdata ).toHaveBeenCalledWith( mockSiteUrl );

		expect( mockLogger.reportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating…' ] );
		expect( mockLogger.reportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Validation successful', true ] );
		expect( mockLogger.reportStart.mock.calls[ 1 ] ).toEqual( [ 'delete', 'Deleting…' ] );
		expect( mockLogger.reportSuccess.mock.calls[ 1 ] ).toEqual( [ 'Deletion successful' ] );
	} );

	it( 'should handle authentication errors', async () => {
		const errorMessage =
			'Authentication required. Please run the Studio app and authenticate first.';
		( getAuthToken as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockSiteUrl );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( deleteSnapshot ).not.toHaveBeenCalled();
	} );

	it( 'should handle snapshot not found errors', async () => {
		( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [] );

		await runCommand( mockSiteUrl );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( deleteSnapshot ).not.toHaveBeenCalled();
	} );

	it( 'should handle delete preview site errors', async () => {
		const errorMessage = 'Failed to delete preview site';
		( deleteSnapshot as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockSiteUrl );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( deleteSnapshotFromAppdata ).not.toHaveBeenCalled();
	} );

	it( 'should handle delete snapshot errors', async () => {
		const errorMessage = 'Failed to delete snapshot';
		( deleteSnapshotFromAppdata as jest.Mock ).mockImplementation( () => {
			throw new LoggerError( errorMessage );
		} );

		await runCommand( mockSiteUrl );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );
} );
