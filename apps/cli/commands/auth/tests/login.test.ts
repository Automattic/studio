import { input } from '@inquirer/prompts';
import { getAuthenticationUrl } from '@studio/common/lib/oauth';
import { readAuthToken, updateSharedConfig } from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { getUserInfo } from 'cli/lib/api';
import { openBrowser } from 'cli/lib/browser';
import { getAppLocale } from 'cli/lib/i18n';
import { LoggerError } from 'cli/logger';
import {
	mockReportStart,
	mockReportSuccess,
	mockReportError,
	mockReportProgress,
	mockReportWarning,
	mockReportKeyValuePair,
} from 'cli/tests/test-utils';
import { runCommand, isHeadlessEnvironment } from '../login';

vi.mock( '@inquirer/prompts' );
vi.mock( '@studio/common/lib/oauth' );
vi.mock( '@studio/common/lib/shared-config', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
	updateSharedConfig: vi.fn(),
} ) );
vi.mock( 'cli/lib/api' );
vi.mock( 'cli/lib/browser' );
vi.mock( 'cli/lib/daemon-client', () => ( {
	emitCliEvent: vi.fn(),
} ) );
vi.mock( 'cli/lib/i18n' );
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

describe( 'Auth Login Command', () => {
	const mockAccessToken = 'mock-access-token-12345';
	const mockAuthUrl = 'https://public-api.wordpress.com/oauth2/authorize?client_id=123';
	const mockUserData = {
		ID: 12345,
		email: 'test@example.com',
		display_name: 'Test User',
		username: 'testuser',
	};
	const mockExistingToken = {
		accessToken: 'existing-token',
		id: 999,
		email: 'existing@example.com',
		displayName: 'Existing User',
		expiresIn: 1209600,
		expirationTime: Date.now() + 1209600000,
	};

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( getAuthenticationUrl ).mockReturnValue( mockAuthUrl );
		vi.mocked( getAppLocale ).mockResolvedValue( 'en' );
		vi.mocked( getUserInfo ).mockResolvedValue( mockUserData );
		vi.mocked( openBrowser ).mockResolvedValue( undefined );
		vi.mocked( input ).mockResolvedValue( mockAccessToken );
		vi.mocked( readAuthToken ).mockResolvedValue( null );
		vi.mocked( updateSharedConfig ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should skip login if already authenticated', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( mockExistingToken );

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
		expect( updateSharedConfig ).toHaveBeenCalledWith( {
			authToken: {
				accessToken: mockAccessToken,
				id: mockUserData.ID,
				email: mockUserData.email,
				displayName: mockUserData.display_name,
				expiresIn: expect.any( Number ),
				expirationTime: expect.any( Number ),
			},
		} );
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

	it( 'should report error if updateSharedConfig fails', async () => {
		const saveError = new Error( 'Failed to save' );
		vi.mocked( updateSharedConfig ).mockRejectedValue( saveError );

		await runCommand();

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'should skip the browser and surface the URL in headless mode', async () => {
		const logSpy = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );

		await runCommand( { headless: true } );

		expect( openBrowser ).not.toHaveBeenCalled();
		expect( logSpy ).toHaveBeenCalledWith( mockAuthUrl );
		expect( input ).toHaveBeenCalled();

		logSpy.mockRestore();
	} );

	it( 'should print the URL even when the browser opens', async () => {
		const logSpy = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );

		await runCommand();

		expect( openBrowser ).toHaveBeenCalledWith( mockAuthUrl );
		expect( logSpy ).toHaveBeenCalledWith( mockAuthUrl );

		logSpy.mockRestore();
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

describe( 'isHeadlessEnvironment', () => {
	const envKeys = [ 'SSH_CONNECTION', 'SSH_TTY', 'SSH_CLIENT', 'DISPLAY', 'WAYLAND_DISPLAY' ];
	let savedEnv: Record< string, string | undefined >;
	let platformSpy: ReturnType< typeof vi.spyOn > | undefined;

	beforeEach( () => {
		savedEnv = {};
		for ( const key of envKeys ) {
			savedEnv[ key ] = process.env[ key ];
			delete process.env[ key ];
		}
	} );

	afterEach( () => {
		for ( const key of envKeys ) {
			if ( savedEnv[ key ] === undefined ) {
				delete process.env[ key ];
			} else {
				process.env[ key ] = savedEnv[ key ];
			}
		}
		platformSpy?.mockRestore();
	} );

	const mockPlatform = ( platform: NodeJS.Platform ) => {
		platformSpy = vi
			.spyOn( process, 'platform', 'get' )
			.mockReturnValue( platform ) as unknown as ReturnType< typeof vi.spyOn >;
	};

	it( 'detects SSH sessions as headless', () => {
		mockPlatform( 'darwin' );
		process.env.SSH_CONNECTION = '10.0.0.1 22 10.0.0.2 22';

		expect( isHeadlessEnvironment() ).toBe( true );
	} );

	it( 'detects Linux without a display server as headless', () => {
		mockPlatform( 'linux' );

		expect( isHeadlessEnvironment() ).toBe( true );
	} );

	it( 'does not flag Linux with a display server', () => {
		mockPlatform( 'linux' );
		process.env.DISPLAY = ':0';

		expect( isHeadlessEnvironment() ).toBe( false );
	} );

	it( 'does not flag a local macOS session', () => {
		mockPlatform( 'darwin' );

		expect( isHeadlessEnvironment() ).toBe( false );
	} );
} );
