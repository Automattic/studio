import { getAuthToken } from 'cli/lib/appdata';
import { getSnapshotsFromAppdata } from 'cli/lib/snapshots';
import { validateSiteFolder } from 'cli/lib/validation';
import { Logger } from 'cli/logger';

jest.mock( 'cli/lib/appdata' );
jest.mock( 'cli/lib/snapshots' );
jest.mock( 'cli/lib/validation' );
jest.mock( 'cli/logger' );

describe( 'Preview List Command', () => {
	const mockFolder = '/test/folder';
	const mockAuthToken = { accessToken: 'mock-auth-token', id: 123 };
	const mockSnapshots = [
		{
			url: 'test1.example.com',
			atomicSiteId: 123,
			localSiteId: '456',
			date: Date.now(),
			name: 'Test Snapshot 1',
			userId: 789,
		},
		{
			url: 'test2.example.com',
			atomicSiteId: 124,
			localSiteId: '457',
			date: Date.now(),
			name: 'Test Snapshot 2',
			userId: 789,
		},
	];

	let mockLogger: {
		reportStart: jest.Mock;
		reportSuccess: jest.Mock;
		reportError: jest.Mock;
	};

	beforeEach( () => {
		jest.clearAllMocks();
		jest.spyOn( process, 'cwd' ).mockReturnValue( mockFolder );

		mockLogger = {
			reportStart: jest.fn(),
			reportSuccess: jest.fn(),
			reportError: jest.fn(),
		};

		( Logger as jest.Mock ).mockReturnValue( mockLogger );
		( validateSiteFolder as jest.Mock ).mockReturnValue( true );
		( getAuthToken as jest.Mock ).mockResolvedValue( mockAuthToken );
		( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( mockSnapshots );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should list preview sites successfully', async () => {
		const { runCommand } = await import( '../list' );
		await runCommand( mockFolder, 'table' );

		expect( validateSiteFolder ).toHaveBeenCalledWith( mockFolder );
		expect( getSnapshotsFromAppdata ).toHaveBeenCalledWith( mockAuthToken.id, mockFolder );
		expect( mockLogger.reportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating...' ] );
		expect( mockLogger.reportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Validation successful' ] );
		expect( mockLogger.reportStart.mock.calls[ 1 ] ).toEqual( [
			'load',
			'Loading preview sites...',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 1 ] ).toEqual( [ 'Found 2 preview sites' ] );
	} );

	it( 'should handle validation errors', async () => {
		const { runCommand } = await import( '../list' );
		( validateSiteFolder as jest.Mock ).mockImplementation( () => {
			throw new Error( 'Invalid site folder' );
		} );

		await runCommand( mockFolder, 'table' );

		expect( mockLogger.reportError ).toHaveBeenCalled();
	} );

	it( 'should handle no snapshots found', async () => {
		const { runCommand } = await import( '../list' );
		( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [] );

		await runCommand( mockFolder, 'table' );

		expect( mockLogger.reportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating...' ] );
		expect( mockLogger.reportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Validation successful' ] );
		expect( mockLogger.reportStart.mock.calls[ 1 ] ).toEqual( [
			'load',
			'Loading preview sites...',
		] );
		expect( mockLogger.reportSuccess.mock.calls[ 1 ] ).toEqual( [ 'No preview sites found' ] );
	} );
} );
