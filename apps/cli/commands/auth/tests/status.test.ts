import { readAuthToken } from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { getUserInfo } from 'cli/lib/api';
import { LoggerError } from 'cli/logger';
import {
	mockReportStart,
	mockReportSuccess,
	mockReportError,
	mockReportProgress,
	mockReportWarning,
	mockReportKeyValuePair,
} from 'cli/tests/test-utils';
import { runCommand } from '../status';

vi.mock( 'cli/lib/api' );
vi.mock( '@studio/common/lib/shared-config', () => ( {
	readAuthToken: vi.fn(),
} ) );
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

		vi.mocked( readAuthToken ).mockResolvedValue( mockToken );
		vi.mocked( getUserInfo ).mockResolvedValue( mockUserData );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'text format (default)', () => {
		it( 'should report success when authenticated', async () => {
			await runCommand();

			expect( mockReportStart ).toHaveBeenCalled();
			expect( readAuthToken ).toHaveBeenCalled();
			expect( getUserInfo ).toHaveBeenCalledWith( mockToken.accessToken );
			expect( mockReportSuccess ).toHaveBeenCalledWith(
				expect.stringContaining( 'Authenticated with WordPress.com as `testuser`' )
			);
		} );

		it( 'should report error when token is invalid', async () => {
			vi.mocked( readAuthToken ).mockResolvedValue( null );

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

	describe( 'json format', () => {
		let consoleLogSpy: ReturnType< typeof vi.spyOn >;

		beforeEach( () => {
			consoleLogSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );
		} );

		afterEach( () => {
			consoleLogSpy.mockRestore();
		} );

		it( 'should output authenticated JSON when token and user info are valid', async () => {
			await runCommand( 'json' );

			expect( getUserInfo ).toHaveBeenCalledWith( mockToken.accessToken );
			expect( consoleLogSpy ).toHaveBeenCalledWith(
				JSON.stringify(
					{
						authenticated: true,
						id: mockUserData.ID,
						username: mockUserData.username,
						email: mockUserData.email,
						displayName: mockUserData.display_name,
					},
					null,
					2
				)
			);
			expect( mockReportSuccess ).not.toHaveBeenCalled();
		} );

		it( 'should output unauthenticated JSON and set exit code when token is missing', async () => {
			vi.mocked( readAuthToken ).mockResolvedValue( null );

			await runCommand( 'json' );

			expect( getUserInfo ).not.toHaveBeenCalled();
			expect( consoleLogSpy ).toHaveBeenCalledWith(
				JSON.stringify( { authenticated: false }, null, 2 )
			);
		} );

		it( 'should forward LoggerError from getUserInfo', async () => {
			const apiError = new LoggerError( 'API error' );
			vi.mocked( getUserInfo ).mockRejectedValue( apiError );

			await runCommand( 'json' );

			expect( mockReportError ).toHaveBeenCalledWith( apiError );
		} );

		it( 'should wrap unknown error when getUserInfo fails', async () => {
			vi.mocked( getUserInfo ).mockRejectedValue( new Error( 'Unknown error' ) );

			await runCommand( 'json' );

			expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		} );
	} );
} );
