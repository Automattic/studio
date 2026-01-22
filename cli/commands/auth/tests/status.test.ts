import { getUserInfo } from 'cli/lib/api';
import { getAuthToken } from 'cli/lib/appdata';
import { LoggerError } from 'cli/logger';
import { vi } from 'vitest';
import { runCommand } from '../status';

const mockReportStart = vi.fn();
const mockReportSuccess = vi.fn();
const mockReportError = vi.fn();
const mockReportProgress = vi.fn();
const mockReportWarning = vi.fn();
const mockReportKeyValuePair = vi.fn();

vi.mock( 'cli/lib/api' );
vi.mock( 'cli/lib/appdata' );
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

describe( 'Auth Status Command', () => {
	const mockToken = {
		accessToken: 'existing-token',
		id: 999,
		email: 'existing@example.com',
		displayName: 'Existing User',
		expiresIn: 1209600,
		expirationTime: 1234567890000 + 1209600000,
	};
	const mockUserData = {
		ID: 999,
		email: 'existing@example.com',
		display_name: 'Existing User',
		username: 'testuser',
	};

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( getAuthToken ).mockResolvedValue( mockToken );
		vi.mocked( getUserInfo ).mockResolvedValue( mockUserData );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should report success when authenticated', async () => {
		await runCommand();

		expect( mockReportStart ).toHaveBeenCalled();
		expect( getAuthToken ).toHaveBeenCalled();
		expect( getUserInfo ).toHaveBeenCalledWith( mockToken.accessToken );
		expect( mockReportSuccess ).toHaveBeenCalledWith(
			expect.stringContaining( 'Authenticated with WordPress.com as `testuser`' )
		);
	} );

	it( 'should report error when token is invalid', async () => {
		vi.mocked( getAuthToken ).mockRejectedValue( new Error( 'Token error' ) );

		await runCommand();

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( getUserInfo ).not.toHaveBeenCalled();
	} );

	it( 'should forward LoggerError from getUserInfo', async () => {
		const apiError = new LoggerError( 'API error' );
		vi.mocked( getUserInfo ).mockRejectedValue( apiError );

		await runCommand();

		expect( mockReportError ).toHaveBeenCalledWith( apiError );
	} );

	it( 'should wrap unknown error when getUserInfo fails', async () => {
		vi.mocked( getUserInfo ).mockRejectedValue( new Error( 'Unknown error' ) );

		await runCommand();

		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );
} );
