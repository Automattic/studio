import { input } from '@inquirer/prompts';
import { getAuthenticationUrl } from 'common/lib/oauth';
import { vi } from 'vitest';
import { getUserInfo } from 'cli/lib/api';
import {
	getAuthToken,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
} from 'cli/lib/appdata';
import { openBrowser } from 'cli/lib/browser';
import { getAppLocale } from 'cli/lib/i18n';
import { LoggerError } from 'cli/logger';
import { runCommand } from '../login';
import {
	mockReportStart,
	mockReportSuccess,
	mockReportError,
	mockReportProgress,
	mockReportWarning,
	mockReportKeyValuePair,
} from 'cli/tests/test-utils';

vi.mock( '@inquirer/prompts' );
vi.mock( 'common/lib/oauth' );
vi.mock( 'cli/lib/api' );
vi.mock( 'cli/lib/appdata' );
vi.mock( 'cli/lib/browser' );
vi.mock( 'cli/lib/i18n' );
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

describe( 'Auth Login Command', () => {
	const mockAccessToken = 'mock-access-token-12345';
	const mockAuthUrl = 'https://public-api.wordpress.com/oauth2/authorize?client_id=123';
	const mockUserData = {
		ID: 12345,
		email: 'test@example.com',
		display_name: 'Test User',
		username: 'testuser',
	};
	const mockAppdata = {
		authToken: {
			accessToken: 'existing-token',
			id: 999,
			email: 'existing@example.com',
			displayName: 'Existing User',
			expiresIn: 1209600,
			expirationTime: Date.now() + 1209600000,
		},
	};

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( getAuthenticationUrl ).mockReturnValue( mockAuthUrl );
		vi.mocked( getAppLocale ).mockResolvedValue( 'en' );
		vi.mocked( getUserInfo ).mockResolvedValue( mockUserData );
		vi.mocked( openBrowser ).mockResolvedValue( undefined );
		vi.mocked( input ).mockResolvedValue( mockAccessToken );
		vi.mocked( readAppdata, { partial: true } ).mockResolvedValue( mockAppdata );
		vi.mocked( getAuthToken ).mockRejectedValue( new Error( 'Mock error' ) );
		vi.mocked( lockAppdata ).mockResolvedValue( undefined );
		vi.mocked( unlockAppdata ).mockResolvedValue( undefined );
		vi.mocked( saveAppdata ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should skip login if already authenticated', async () => {
		vi.mocked( getAuthToken ).mockResolvedValue( mockAppdata.authToken );

		await runCommand();

		expect( openBrowser ).not.toHaveBeenCalled();
		expect( input ).not.toHaveBeenCalled();
	} );

	it( 'should complete the login process successfully', async () => {
		await runCommand();

		expect( getAuthenticationUrl ).toHaveBeenCalledWith(
			'en',
			'https://developer.wordpress.com/copy-oauth-token'
		);
		expect( openBrowser ).toHaveBeenCalledWith( mockAuthUrl );
		expect( input ).toHaveBeenCalledWith( {
			message: 'Authentication token:',
		} );
		expect( getUserInfo ).toHaveBeenCalledWith( mockAccessToken );
		expect( lockAppdata ).toHaveBeenCalled();
		expect( saveAppdata ).toHaveBeenCalledWith( {
			authToken: {
				accessToken: mockAccessToken,
				id: mockUserData.ID,
				email: mockUserData.email,
				displayName: mockUserData.display_name,
				expiresIn: expect.any( Number ),
				expirationTime: expect.any( Number ),
			},
		} );
		expect( unlockAppdata ).toHaveBeenCalled();
	} );

	it( 'should proceed with login if existing token is invalid', async () => {
		await runCommand();

		expect( openBrowser ).toHaveBeenCalled();
		expect( input ).toHaveBeenCalled();
	} );

	it( 'should handle browser open failure', async () => {
		const browserError = new LoggerError( 'Failed to open browser' );
		vi.mocked( openBrowser ).mockRejectedValue( browserError );

		await runCommand();

		expect( input ).toHaveBeenCalled();
	} );

	it( 'should handle API error when fetching user info', async () => {
		const apiError = new LoggerError( 'Failed to fetch user info' );
		vi.mocked( getUserInfo ).mockRejectedValue( apiError );

		await runCommand();

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( getUserInfo ).toHaveBeenCalled();
	} );

	it( 'should unlock appdata even if save fails', async () => {
		const saveError = new Error( 'Failed to save' );
		vi.mocked( saveAppdata ).mockRejectedValue( saveError );

		await runCommand();

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( lockAppdata ).toHaveBeenCalled();
		expect( unlockAppdata ).toHaveBeenCalled();
	} );

	it( 'should handle lock appdata failure', async () => {
		const lockError = new Error( 'Failed to lock' );
		vi.mocked( lockAppdata ).mockRejectedValue( lockError );

		await runCommand();

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'should use provided locale', async () => {
		vi.mocked( getAppLocale ).mockResolvedValue( 'fr' );

		await runCommand();

		expect( getAuthenticationUrl ).toHaveBeenCalledWith(
			'fr',
			'https://developer.wordpress.com/copy-oauth-token'
		);
	} );
} );
