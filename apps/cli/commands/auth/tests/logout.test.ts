import { readAuthToken, updateSharedConfig } from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { revokeAuthToken } from 'cli/lib/api';
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

vi.mock( '@studio/common/lib/shared-config', () => ( {
	readAuthToken: vi.fn(),
	updateSharedConfig: vi.fn(),
} ) );
vi.mock( 'cli/lib/api' );
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

describe( 'Auth Logout Command', () => {
	const mockAuthToken = {
		accessToken: 'existing-token',
		id: 999,
		email: 'existing@example.com',
		displayName: 'Existing User',
		expiresIn: 1209600,
		expirationTime: Date.now() + 1209600000,
	};

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( readAuthToken ).mockResolvedValue( mockAuthToken );
		vi.mocked( revokeAuthToken ).mockResolvedValue( undefined );
		vi.mocked( updateSharedConfig ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should complete the logout process successfully', async () => {
		await runCommand();

		expect( readAuthToken ).toHaveBeenCalled();
		expect( revokeAuthToken ).toHaveBeenCalled();
		expect( updateSharedConfig ).toHaveBeenCalledWith( { authToken: undefined } );
		expect( mockReportSuccess ).toHaveBeenCalledWith( 'Successfully logged out' );
	} );

	it( 'should report an error if revoking the token fails', async () => {
		vi.mocked( revokeAuthToken ).mockRejectedValue( new Error( 'Failed to revoke token' ) );

		await runCommand();

		expect( readAuthToken ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'should report already logged out if no auth token exists', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( null );

		await runCommand();

		expect( readAuthToken ).toHaveBeenCalled();
		expect( revokeAuthToken ).not.toHaveBeenCalled();
		expect( mockReportSuccess ).toHaveBeenCalledWith( 'Already logged out' );
	} );
} );
