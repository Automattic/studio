import { Command } from 'commander';
import { deleteSnapshot } from 'cli/lib/api';
import { getAuthToken } from 'cli/lib/auth';
import { deleteSnapshotFromAppdata, getSnapshotsFromAppdata } from 'cli/lib/snapshots';
import { Logger } from 'cli/logger';

jest.mock( 'cli/lib/auth' );
jest.mock( 'cli/lib/snapshots' );
jest.mock( 'cli/lib/api' );
jest.mock( 'cli/logger' );

describe( 'Preview Delete Command', () => {
	const mockHost = 'example.com';
	const mockAuthToken = { accessToken: 'mock-auth-token', id: 123 };
	const mockSnapshots = [
		{
			url: 'example.com',
			atomicSiteId: 123,
			localSiteId: '456',
			date: Date.now(),
			name: 'Test Snapshot',
			userId: 123,
		},
	];
	let program: Command;
	let mockLogger: {
		reportStart: jest.Mock;
		reportSuccess: jest.Mock;
		reportError: jest.Mock;
	};

	beforeEach( () => {
		jest.clearAllMocks();
		( getAuthToken as jest.Mock ).mockResolvedValue( mockAuthToken );
		( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( mockSnapshots );
		( deleteSnapshot as jest.Mock ).mockResolvedValue( undefined );
		( deleteSnapshotFromAppdata as jest.Mock ).mockResolvedValue( undefined );

		program = new Command( 'studio' );
		mockLogger = {
			reportStart: jest.fn(),
			reportSuccess: jest.fn(),
			reportError: jest.fn(),
		};
		( Logger as jest.Mock ).mockReturnValue( mockLogger );
	} );

	it( 'should successfully delete a snapshot', async () => {
		const { registerCommand } = await import( '../delete' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'studio', 'delete', mockHost ] );

		expect( mockLogger.reportStart ).toHaveBeenCalledWith( 'validate', 'Validating...' );
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'Validation successful' );
		expect( mockLogger.reportStart ).toHaveBeenCalledWith( 'delete', 'Deleting...' );
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'Deletion successful' );
		expect( deleteSnapshot ).toHaveBeenCalledWith(
			mockSnapshots[ 0 ].atomicSiteId,
			mockAuthToken.accessToken
		);
		expect( deleteSnapshotFromAppdata ).toHaveBeenCalledWith( mockSnapshots[ 0 ].url );
	} );

	it( 'should handle snapshot not found error', async () => {
		const { registerCommand } = await import( '../delete' );
		registerCommand( program );
		( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [] );

		await program.parseAsync( [ 'node', 'studio', 'delete', 'nonexistent.com' ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( deleteSnapshot ).not.toHaveBeenCalled();
		expect( deleteSnapshotFromAppdata ).not.toHaveBeenCalled();
	} );

	it( 'should handle API deletion error', async () => {
		const { registerCommand } = await import( '../delete' );
		registerCommand( program );
		( deleteSnapshot as jest.Mock ).mockRejectedValue( new Error( 'API error' ) );

		await program.parseAsync( [ 'node', 'studio', 'delete', mockHost ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( deleteSnapshotFromAppdata ).not.toHaveBeenCalled();
	} );

	it( 'should handle local deletion error', async () => {
		const { registerCommand } = await import( '../delete' );
		registerCommand( program );
		( deleteSnapshotFromAppdata as jest.Mock ).mockRejectedValue(
			new Error( 'Local deletion error' )
		);

		await program.parseAsync( [ 'node', 'studio', 'delete', mockHost ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( deleteSnapshot ).toHaveBeenCalled();
	} );
} );
