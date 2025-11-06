import { password } from '@inquirer/prompts';
import { getAuthenticationUrl } from 'common/lib/oauth';
import { validateAccessToken, getUserInfo } from 'cli/lib/api';
import { lockAppdata, readAppdata, saveAppdata, unlockAppdata } from 'cli/lib/appdata';
import { openBrowser } from 'cli/lib/browser';
import { Logger, LoggerError } from 'cli/logger';

jest.mock( '@inquirer/prompts' );
jest.mock( 'common/lib/oauth' );
jest.mock( 'cli/lib/api' );
jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	lockAppdata: jest.fn(),
	readAppdata: jest.fn(),
	saveAppdata: jest.fn(),
	unlockAppdata: jest.fn(),
} ) );
jest.mock( 'cli/lib/browser' );
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
		( validateAccessToken as jest.Mock ).mockResolvedValue( undefined );
		( getUserInfo as jest.Mock ).mockResolvedValue( mockUserData );
		( openBrowser as jest.Mock ).mockResolvedValue( undefined );
		( password as jest.Mock ).mockResolvedValue( mockAccessToken );
		( readAppdata as jest.Mock ).mockResolvedValue( {} );
		( lockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( unlockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( saveAppdata as jest.Mock ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should skip login if already authenticated', async () => {
		( readAppdata as jest.Mock ).mockResolvedValue( mockAppdata );

		const { runCommand } = await import( '../login' );
		await runCommand( 'en' );

		expect( validateAccessToken ).toHaveBeenCalledWith( 'existing-token' );
		expect( openBrowser ).not.toHaveBeenCalled();
		expect( password ).not.toHaveBeenCalled();
	} );

	it( 'should complete the login process successfully', async () => {
		const { runCommand } = await import( '../login' );
		await runCommand( 'en' );

		expect( getAuthenticationUrl ).toHaveBeenCalledWith(
			'en',
			'https://developer.wordpress.com/copy-oauth-token'
		);
		expect( openBrowser ).toHaveBeenCalledWith( mockAuthUrl );
		expect( password ).toHaveBeenCalledWith( {
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
		( readAppdata as jest.Mock ).mockResolvedValue( mockAppdata );
		( validateAccessToken as jest.Mock ).mockRejectedValue( new Error( 'Invalid token' ) );

		const { runCommand } = await import( '../login' );
		await runCommand( 'en' );

		expect( validateAccessToken ).toHaveBeenCalledWith( 'existing-token' );
		expect( openBrowser ).toHaveBeenCalled();
		expect( password ).toHaveBeenCalled();
	} );

	it( 'should handle browser open failure', async () => {
		const browserError = new LoggerError( 'Failed to open browser' );
		( openBrowser as jest.Mock ).mockRejectedValue( browserError );

		const { runCommand } = await import( '../login' );
		await runCommand( 'en' );

		expect( password ).toHaveBeenCalled();
	} );

	it( 'should handle API error when fetching user info', async () => {
		const apiError = new LoggerError( 'Failed to fetch user info' );
		( getUserInfo as jest.Mock ).mockRejectedValue( apiError );

		const { runCommand } = await import( '../login' );
		await runCommand( 'en' );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( getUserInfo ).toHaveBeenCalled();
	} );

	it( 'should unlock appdata even if save fails', async () => {
		const saveError = new Error( 'Failed to save' );
		( saveAppdata as jest.Mock ).mockRejectedValue( saveError );

		const { runCommand } = await import( '../login' );
		await runCommand( 'en' );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( lockAppdata ).toHaveBeenCalled();
		expect( unlockAppdata ).toHaveBeenCalled();
	} );

	it( 'should handle lock appdata failure', async () => {
		const lockError = new Error( 'Failed to lock' );
		( lockAppdata as jest.Mock ).mockRejectedValue( lockError );

		const { runCommand } = await import( '../login' );
		await runCommand( 'en' );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'should use provided locale', async () => {
		const { runCommand } = await import( '../login' );
		await runCommand( 'fr' );

		expect( getAuthenticationUrl ).toHaveBeenCalledWith(
			'fr',
			'https://developer.wordpress.com/copy-oauth-token'
		);
	} );
} );
