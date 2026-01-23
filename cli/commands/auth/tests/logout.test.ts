import { vi } from 'vitest';
import { revokeAuthToken } from 'cli/lib/api';
import {
	getAuthToken,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
} from 'cli/lib/appdata';
import { LoggerError } from 'cli/logger';
import {
	mockReportStart,
	mockReportSuccess,
	mockReportError,
	mockReportProgress,
	mockReportWarning,
	mockReportKeyValuePair,
} from 'cli/tests/test-utils';
import { runCommand } from '../logout';

vi.mock( 'cli/lib/appdata' );
vi.mock( 'cli/lib/api' );
vi.mock( 'cli/logger', () => ( {
	Logger: vi.fn( () => ( {
		reportStart: mockReportStart,
		reportSuccess: mockReportSuccess,
		reportError: mockReportError,
		reportProgress: mockReportProgress,
		reportWarning: mockReportWarning,
		reportKeyValuePair: mockReportKeyValuePair,
		spinner: {},
		currentAction: null,
	} ) ),
	LoggerError: class LoggerError extends Error {},
} ) );

describe( 'Auth Logout Command', () => {
	function getMockAppdata() {
		return {
			sites: [],
			snapshots: [],
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

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( getAuthToken ).mockResolvedValue( getMockAppdata().authToken );
		vi.mocked( revokeAuthToken ).mockResolvedValue( undefined );
		vi.mocked( lockAppdata ).mockResolvedValue( undefined );
		vi.mocked( unlockAppdata ).mockResolvedValue( undefined );
		vi.mocked( readAppdata ).mockResolvedValue( getMockAppdata() );
		vi.mocked( saveAppdata ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should complete the logout process successfully', async () => {
		await runCommand();

		expect( getAuthToken ).toHaveBeenCalled();
		expect( revokeAuthToken ).toHaveBeenCalled();
		expect( lockAppdata ).toHaveBeenCalled();
		expect( readAppdata ).toHaveBeenCalled();
		expect( saveAppdata ).toHaveBeenCalledWith(
			expect.not.objectContaining( { authToken: expect.anything() } )
		);
		expect( unlockAppdata ).toHaveBeenCalled();
		expect( mockReportSuccess ).toHaveBeenCalledWith( 'Successfully logged out' );
	} );

	it( 'should report an error if revoking the token fails', async () => {
		vi.mocked( revokeAuthToken ).mockRejectedValue( new Error( 'Failed to revoke token' ) );

		await runCommand();

		expect( getAuthToken ).toHaveBeenCalled();
		expect( lockAppdata ).toHaveBeenCalled();
		expect( readAppdata ).not.toHaveBeenCalled();
		expect( saveAppdata ).not.toHaveBeenCalledWith( {} );
		expect( unlockAppdata ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'should report already logged out if no auth token exists', async () => {
		vi.mocked( getAuthToken ).mockRejectedValue( new Error( 'No auth token' ) );

		await runCommand();

		expect( getAuthToken ).toHaveBeenCalled();
		expect( revokeAuthToken ).not.toHaveBeenCalled();
		expect( lockAppdata ).not.toHaveBeenCalled();
		expect( readAppdata ).not.toHaveBeenCalled();
		expect( saveAppdata ).not.toHaveBeenCalled();
		expect( mockReportSuccess ).toHaveBeenCalledWith( 'Already logged out' );
	} );

	it( 'should unlock appdata even if save fails', async () => {
		vi.mocked( saveAppdata ).mockRejectedValue( new Error( 'Failed to save' ) );

		await runCommand();

		expect( revokeAuthToken ).toHaveBeenCalled();
		expect( lockAppdata ).toHaveBeenCalled();
		expect( unlockAppdata ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );
} );
