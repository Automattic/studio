import { disconnectProvider } from '@studio/common/lib/ai-settings';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
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

vi.mock( '@studio/common/lib/shared-config', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/ai-settings', () => ( { disconnectProvider: vi.fn() } ) );
vi.mock( 'cli/lib/daemon-client', () => ( {
	emitCliEvent: vi.fn(),
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
		vi.mocked( disconnectProvider ).mockResolvedValue( undefined as never );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should complete the logout process successfully', async () => {
		await runCommand();

		expect( readAuthToken ).toHaveBeenCalled();
		expect( disconnectProvider ).toHaveBeenCalledWith(
			expect.objectContaining( { descriptor: expect.objectContaining( { id: 'wpcom' } ) } )
		);
		expect( mockReportSuccess ).toHaveBeenCalledWith( 'Successfully logged out' );
	} );

	it( 'should report an error if clearing the token fails', async () => {
		vi.mocked( disconnectProvider ).mockRejectedValue( new Error( 'Failed to write config' ) );

		await runCommand();

		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'should report already logged out if no auth token exists', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( null );

		await runCommand();

		expect( readAuthToken ).toHaveBeenCalled();
		expect( disconnectProvider ).not.toHaveBeenCalled();
		expect( mockReportSuccess ).toHaveBeenCalledWith( 'Already logged out' );
	} );
} );
