import { getUserInfo } from 'cli/lib/api';
import { getAuthToken } from 'cli/lib/appdata';
import { Logger, LoggerError } from 'cli/logger';
import { runCommand } from '../status';

jest.mock( 'cli/lib/api' );
jest.mock( 'cli/lib/appdata' );
jest.mock( 'cli/logger' );

describe( 'Auth Status Command', () => {
	const mockToken = {
		accessToken: 'existing-token',
		id: 999,
		email: 'existing@example.com',
		displayName: 'Existing User',
		expiresIn: 1209600,
		expirationTime: Date.now() + 1209600000,
	};
	const mockUserData = {
		username: 'testuser',
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

		( Logger as unknown as jest.Mock ).mockReturnValue( mockLogger );
		( getAuthToken as jest.Mock ).mockResolvedValue( mockToken );
		( getUserInfo as jest.Mock ).mockResolvedValue( mockUserData );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should report success when authenticated', async () => {
		await runCommand();

		expect( mockLogger.reportStart ).toHaveBeenCalled();
		expect( getAuthToken ).toHaveBeenCalled();
		expect( getUserInfo ).toHaveBeenCalledWith( mockToken.accessToken );
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
			expect.stringContaining( 'Authenticated with WordPress.com as `testuser`' )
		);
	} );

	it( 'should report error when token is invalid', async () => {
		( getAuthToken as jest.Mock ).mockRejectedValue( new Error( 'Token error' ) );

		await runCommand();

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( getUserInfo ).not.toHaveBeenCalled();
	} );

	it( 'should forward LoggerError from getUserInfo', async () => {
		const apiError = new LoggerError( 'API error' );
		( getUserInfo as jest.Mock ).mockRejectedValue( apiError );

		await runCommand();

		expect( mockLogger.reportError ).toHaveBeenCalledWith( apiError );
	} );

	it( 'should wrap unknown error when getUserInfo fails', async () => {
		( getUserInfo as jest.Mock ).mockRejectedValue( new Error( 'Unknown error' ) );

		await runCommand();

		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );
} );
