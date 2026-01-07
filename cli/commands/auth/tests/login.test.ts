import { input } from '@inquirer/prompts';
import { getAuthenticationUrl } from 'common/lib/oauth';
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
import { Logger, LoggerError } from 'cli/logger';
import { runCommand } from '../login';

jest.mock( '@inquirer/prompts' );
jest.mock( 'common/lib/oauth' );
jest.mock( 'cli/lib/api' );
jest.mock( 'cli/lib/appdata' );
jest.mock( 'cli/lib/browser' );
jest.mock( 'cli/lib/i18n' );
jest.mock( 'cli/logger' );

describe( 'Auth Login Command', () => {
	const mockAccessToken = 'mock-access-token-12345';
	const mockAuthUrl = 'https://public-api.wordpress.com/oauth2/authorize?client_id=123';
	const mockUserData = {
		ID: 12345,
		email: 'test@example.com',
		display_name: 'Test User',
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

	let mockLogger: {
		reportStart: jest.Mock;
		reportSuccess: jest.Mock;
		reportError: jest.Mock;
		reportKeyValuePair: jest.Mock;
	};

	beforeEach( () => {
		jest.clearAllMocks();

		mockLogger = {
			reportStart: jest.fn(),
			reportSuccess: jest.fn(),
			reportError: jest.fn(),
			reportKeyValuePair: jest.fn(),
		};

		( Logger as jest.Mock ).mockReturnValue( mockLogger );
		( getAuthenticationUrl as jest.Mock ).mockReturnValue( mockAuthUrl );
		( getAppLocale as jest.Mock ).mockResolvedValue( 'en' );
		( getUserInfo as jest.Mock ).mockResolvedValue( mockUserData );
		( openBrowser as jest.Mock ).mockResolvedValue( undefined );
		( input as jest.Mock ).mockResolvedValue( mockAccessToken );
		( readAppdata as jest.Mock ).mockResolvedValue( mockAppdata );
		( getAuthToken as jest.Mock ).mockRejectedValue( new Error( 'Mock error' ) );
		( lockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( unlockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( saveAppdata as jest.Mock ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should skip login if already authenticated', async () => {
		( getAuthToken as jest.Mock ).mockResolvedValue( mockAppdata.authToken );

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
		( openBrowser as jest.Mock ).mockRejectedValue( browserError );

		await runCommand();

		expect( input ).toHaveBeenCalled();
	} );

	it( 'should handle API error when fetching user info', async () => {
		const apiError = new LoggerError( 'Failed to fetch user info' );
		( getUserInfo as jest.Mock ).mockRejectedValue( apiError );

		await runCommand();

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( getUserInfo ).toHaveBeenCalled();
	} );

	it( 'should unlock appdata even if save fails', async () => {
		const saveError = new Error( 'Failed to save' );
		( saveAppdata as jest.Mock ).mockRejectedValue( saveError );

		await runCommand();

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( lockAppdata ).toHaveBeenCalled();
		expect( unlockAppdata ).toHaveBeenCalled();
	} );

	it( 'should handle lock appdata failure', async () => {
		const lockError = new Error( 'Failed to lock' );
		( lockAppdata as jest.Mock ).mockRejectedValue( lockError );

		await runCommand();

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'should use provided locale', async () => {
		( getAppLocale as jest.Mock ).mockResolvedValue( 'fr' );

		await runCommand();

		expect( getAuthenticationUrl ).toHaveBeenCalledWith(
			'fr',
			'https://developer.wordpress.com/copy-oauth-token'
		);
	} );
} );
