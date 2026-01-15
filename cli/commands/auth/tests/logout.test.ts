import { vi, type Mock } from 'vitest';
import { revokeAuthToken } from 'cli/lib/api';
import {
	getAuthToken,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
} from 'cli/lib/appdata';
import { Logger, LoggerError } from 'cli/logger';

vi.mock( 'cli/lib/appdata' );
vi.mock( 'cli/logger' );
vi.mock( 'cli/lib/api' );

describe( 'Auth Logout Command', () => {
	function getMockAppdata() {
		return {
			authToken: {
				accessToken: 'existing-token',
				id: 999,
				email: 'existing@example.com',
				displayName: 'Existing User',
				expiresIn: 1209600,
				expirationTime: Date.now() + 1209600000,
			},
		};
	}

	let mockLogger: {
		reportStart: Mock;
		reportSuccess: Mock;
		reportError: Mock;
	};

	beforeEach( () => {
		vi.clearAllMocks();

		mockLogger = {
			reportStart: vi.fn(),
			reportSuccess: vi.fn(),
			reportError: vi.fn(),
		};

		( Logger as Mock ).mockReturnValue( mockLogger );
		( getAuthToken as Mock ).mockResolvedValue( getMockAppdata().authToken );
		( revokeAuthToken as Mock ).mockResolvedValue( undefined );
		( lockAppdata as Mock ).mockResolvedValue( undefined );
		( unlockAppdata as Mock ).mockResolvedValue( undefined );
		( readAppdata as Mock ).mockResolvedValue( getMockAppdata() );
		( saveAppdata as Mock ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should complete the logout process successfully', async () => {
		const { runCommand } = await import( '../logout' );
		await runCommand();

		expect( getAuthToken ).toHaveBeenCalled();
		expect( revokeAuthToken ).toHaveBeenCalled();
		expect( lockAppdata ).toHaveBeenCalled();
		expect( readAppdata ).toHaveBeenCalled();
		expect( saveAppdata ).toHaveBeenCalledWith(
			expect.not.objectContaining( { authToken: expect.anything() } )
		);
		expect( unlockAppdata ).toHaveBeenCalled();
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'Successfully logged out' );
	} );

	it( 'should report an error if revoking the token fails', async () => {
		( revokeAuthToken as Mock ).mockRejectedValue( new Error( 'Failed to revoke token' ) );

		const { runCommand } = await import( '../logout' );
		await runCommand();

		expect( getAuthToken ).toHaveBeenCalled();
		expect( lockAppdata ).toHaveBeenCalled();
		expect( readAppdata ).not.toHaveBeenCalled();
		expect( saveAppdata ).not.toHaveBeenCalledWith( {} );
		expect( unlockAppdata ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'should report already logged out if no auth token exists', async () => {
		( getAuthToken as Mock ).mockRejectedValue( new Error( 'No auth token' ) );

		const { runCommand } = await import( '../logout' );
		await runCommand();

		expect( getAuthToken ).toHaveBeenCalled();
		expect( revokeAuthToken ).not.toHaveBeenCalled();
		expect( lockAppdata ).not.toHaveBeenCalled();
		expect( readAppdata ).not.toHaveBeenCalled();
		expect( saveAppdata ).not.toHaveBeenCalled();
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'Already logged out' );
	} );

	it( 'should unlock appdata even if save fails', async () => {
		( saveAppdata as Mock ).mockRejectedValue( new Error( 'Failed to save' ) );

		const { runCommand } = await import( '../logout' );
		await runCommand();

		expect( revokeAuthToken ).toHaveBeenCalled();
		expect( lockAppdata ).toHaveBeenCalled();
		expect( unlockAppdata ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );
} );
