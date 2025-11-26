// Mock dependencies before importing pm2-manager
jest.mock( 'fs' );
jest.mock( 'os', () => ( {
	homedir: jest.fn().mockReturnValue( '/home/user' ),
} ) );
jest.mock( 'cli/lib/appdata', () => ( {
	getAppdataPath: jest.fn().mockReturnValue( '/home/user/.studio/appdata' ),
} ) );
// Create a mock pm2 module
const mockPm2 = {
	connect: jest.fn(),
	disconnect: jest.fn(),
	list: jest.fn(),
	start: jest.fn(),
	delete: jest.fn(),
};

// Mock the pm2 module at require time
jest.mock(
	'pm2',
	() => {
		return mockPm2;
	},
	{ virtual: true }
);

import fs from 'fs';
import os from 'os';
import { getAppdataPath } from 'cli/lib/appdata';
// Import the module after mocks are set up
import {
	connect,
	disconnect,
	startProcess,
	stopProcess,
	isProcessRunning,
	startProxyProcess,
	isProxyProcessRunning,
} from '../pm2-manager';

describe( 'PM2 Manager', () => {
	beforeEach( () => {
		jest.clearAllMocks();

		// Reset connection state by calling disconnect
		disconnect();

		// Setup default mocks
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( os.homedir as jest.Mock ).mockReturnValue( '/home/user' );
		( getAppdataPath as jest.Mock ).mockReturnValue( '/home/user/.studio/appdata' );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'connect', () => {
		it( 'should connect to PM2 daemon successfully', async () => {
			mockPm2.connect.mockImplementation( ( callback ) => {
				callback( null );
			} );

			await connect();

			expect( mockPm2.connect ).toHaveBeenCalledTimes( 1 );
			expect( mockPm2.connect ).toHaveBeenCalledWith( expect.any( Function ) );
		} );

		it( 'should handle connection errors', async () => {
			const error = new Error( 'Connection failed' );
			mockPm2.connect.mockImplementation( ( callback ) => {
				callback( error );
			} );

			await expect( connect() ).rejects.toThrow( 'Connection failed' );
		} );

		it( 'should timeout after 10 seconds', async () => {
			jest.useFakeTimers();

			mockPm2.connect.mockImplementation( () => {
				// Never call the callback - simulate hanging
			} );

			const connectPromise = connect();

			// Fast-forward time by 10 seconds
			jest.advanceTimersByTime( 10000 );

			await expect( connectPromise ).rejects.toThrow( 'PM2 connection timeout after 10 seconds' );

			jest.useRealTimers();
		} );

		it( 'should be idempotent (skip if already connected)', async () => {
			mockPm2.connect.mockImplementation( ( callback ) => {
				callback( null );
			} );

			await connect();
			await connect(); // Second call

			// Should only connect once
			expect( mockPm2.connect ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'should clear timeout on successful connection', async () => {
			jest.useFakeTimers();

			mockPm2.connect.mockImplementation( ( callback ) => {
				// Simulate immediate connection
				callback( null );
			} );

			await connect();

			// Advance timers - timeout should be cleared, no error should occur
			jest.advanceTimersByTime( 10000 );

			jest.useRealTimers();
		} );
	} );

	describe( 'disconnect', () => {
		it( 'should disconnect from PM2 daemon when connected', async () => {
			mockPm2.connect.mockImplementation( ( callback ) => {
				callback( null );
			} );

			await connect();

			// Clear the disconnect call from beforeEach
			jest.clearAllMocks();

			disconnect();

			expect( mockPm2.disconnect ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'should not call pm2.disconnect if not connected', () => {
			disconnect();

			expect( mockPm2.disconnect ).not.toHaveBeenCalled();
		} );

		it( 'should allow reconnection after disconnect', async () => {
			mockPm2.connect.mockImplementation( ( callback ) => {
				callback( null );
			} );

			await connect();
			disconnect();
			await connect(); // Should connect again

			expect( mockPm2.connect ).toHaveBeenCalledTimes( 2 );
		} );
	} );

	describe( 'isProcessRunning', () => {
		beforeEach( async () => {
			mockPm2.connect.mockImplementation( ( callback ) => {
				callback( null );
			} );
			await connect();
		} );

		it( 'should return process description when process is running', async () => {
			const mockProcess = {
				name: 'test-process',
				pm_id: 1, // Using 1 to avoid || -1 edge case with 0
				pid: 12345,
				pm2_env: { status: 'online' },
			};

			mockPm2.list.mockImplementation( ( callback ) => {
				callback( null, [ mockProcess ] );
			} );

			const result = await isProcessRunning( 'test-process' );

			expect( result ).toEqual( {
				name: 'test-process',
				pmId: 1,
				status: 'online',
				pid: 12345,
			} );
		} );

		it( 'should return undefined when process is not found', async () => {
			mockPm2.list.mockImplementation( ( callback ) => {
				callback( null, [] );
			} );

			const result = await isProcessRunning( 'non-existent-process' );

			expect( result ).toBeUndefined();
		} );

		it( 'should return undefined when process status is not online', async () => {
			const mockProcess = {
				name: 'test-process',
				pm_id: 0,
				pid: 12345,
				pm2_env: { status: 'stopped' },
			};

			mockPm2.list.mockImplementation( ( callback ) => {
				callback( null, [ mockProcess ] );
			} );

			const result = await isProcessRunning( 'test-process' );

			expect( result ).toBeUndefined();
		} );

		it( 'should return undefined when not connected', async () => {
			disconnect();

			const result = await isProcessRunning( 'test-process' );

			expect( result ).toBeUndefined();
			expect( mockPm2.list ).not.toHaveBeenCalled();
		} );

		it( 'should handle pm2.list errors gracefully', async () => {
			const consoleErrorSpy = jest.spyOn( console, 'error' ).mockImplementation();
			mockPm2.list.mockImplementation( ( callback ) => {
				callback( new Error( 'List error' ) );
			} );

			const result = await isProcessRunning( 'test-process' );

			expect( result ).toBeUndefined();
			expect( consoleErrorSpy ).toHaveBeenCalledWith(
				'Error checking if process test-process is running:',
				expect.any( Error )
			);

			consoleErrorSpy.mockRestore();
		} );
	} );

	describe( 'startProcess', () => {
		it( 'should start a process successfully', async () => {
			const mockApp = {
				pm2_env: {
					pm_id: 0,
					status: 'online',
				},
				pid: 12345,
			};

			mockPm2.start.mockImplementation( ( config, callback ) => {
				callback( null, [ mockApp ] );
			} );

			const result = await startProcess( 'test-process', '/path/to/script.js' );

			expect( mockPm2.start ).toHaveBeenCalledWith(
				{
					name: 'test-process',
					interpreter: process.execPath,
					script: '/path/to/script.js',
					exec_mode: 'fork',
					autorestart: false,
					env: {},
				},
				expect.any( Function )
			);

			expect( result ).toEqual( {
				name: 'test-process',
				pmId: 0,
				status: 'online',
				pid: 12345,
			} );
		} );

		it( 'should start a process with environment variables', async () => {
			const mockApp = {
				pm2_env: {
					pm_id: 1,
					status: 'online',
				},
				pid: 54321,
			};

			mockPm2.start.mockImplementation( ( config, callback ) => {
				callback( null, [ mockApp ] );
			} );

			const env = { TEST_VAR: 'test-value' };
			await startProcess( 'test-process', '/path/to/script.js', env );

			expect( mockPm2.start ).toHaveBeenCalledWith(
				expect.objectContaining( {
					env,
				} ),
				expect.any( Function )
			);
		} );

		it( 'should handle pm2.start errors', async () => {
			const error = new Error( 'Start failed' );
			mockPm2.start.mockImplementation( ( config, callback ) => {
				callback( error );
			} );

			await expect( startProcess( 'test-process', '/path/to/script.js' ) ).rejects.toThrow(
				'Start failed'
			);
		} );

		it( 'should handle incomplete PM2 response', async () => {
			mockPm2.start.mockImplementation( ( config, callback ) => {
				callback( null, [] );
			} );

			await expect( startProcess( 'test-process', '/path/to/script.js' ) ).rejects.toThrow(
				'Failed to start process test-process: PM2 returned incomplete response'
			);
		} );

		it( 'should handle missing pm2_env in response', async () => {
			const mockApp = {
				pid: 12345,
			};

			mockPm2.start.mockImplementation( ( config, callback ) => {
				callback( null, [ mockApp ] );
			} );

			await expect( startProcess( 'test-process', '/path/to/script.js' ) ).rejects.toThrow(
				'Failed to start process test-process: PM2 returned incomplete response'
			);
		} );
	} );

	describe( 'stopProcess', () => {
		it( 'should stop a process successfully', async () => {
			mockPm2.delete.mockImplementation( ( processName, callback ) => {
				callback( null );
			} );

			await stopProcess( 'test-process' );

			expect( mockPm2.delete ).toHaveBeenCalledWith( 'test-process', expect.any( Function ) );
		} );

		it( 'should handle "process name not found" error gracefully', async () => {
			const error = new Error( 'process name not found' );
			mockPm2.delete.mockImplementation( ( processName, callback ) => {
				callback( error );
			} );

			await expect( stopProcess( 'non-existent-process' ) ).resolves.toBeUndefined();
		} );

		it( 'should reject on other errors', async () => {
			const error = new Error( 'Delete failed' );
			mockPm2.delete.mockImplementation( ( processName, callback ) => {
				callback( error );
			} );

			await expect( stopProcess( 'test-process' ) ).rejects.toThrow( 'Delete failed' );
		} );
	} );

	describe( 'startProxyProcess', () => {
		it( 'should start the proxy process with correct configuration', async () => {
			const mockApp = {
				pm2_env: {
					pm_id: 1,
					status: 'online',
				},
				pid: 99999,
			};

			mockPm2.start.mockImplementation( ( config, callback ) => {
				callback( null, [ mockApp ] );
			} );

			const result = await startProxyProcess();

			expect( mockPm2.start ).toHaveBeenCalledWith(
				expect.objectContaining( {
					name: 'studio-proxy',
					script: expect.stringContaining( 'proxy-daemon.js' ),
					env: expect.objectContaining( {
						STUDIO_USER_HOME: '/home/user',
						STUDIO_APPDATA_PATH: '/home/user/.studio/appdata',
					} ),
				} ),
				expect.any( Function )
			);

			expect( result ).toEqual( {
				name: 'studio-proxy',
				pmId: 1,
				status: 'online',
				pid: 99999,
			} );
		} );

		it( 'should include ELECTRON_RUN_AS_NODE if set in process.env', async () => {
			process.env.ELECTRON_RUN_AS_NODE = '1';

			const mockApp = {
				pm2_env: {
					pm_id: 1,
					status: 'online',
				},
				pid: 99999,
			};

			mockPm2.start.mockImplementation( ( config, callback ) => {
				callback( null, [ mockApp ] );
			} );

			await startProxyProcess();

			expect( mockPm2.start ).toHaveBeenCalledWith(
				expect.objectContaining( {
					env: expect.objectContaining( {
						ELECTRON_RUN_AS_NODE: '1',
					} ),
				} ),
				expect.any( Function )
			);

			delete process.env.ELECTRON_RUN_AS_NODE;
		} );
	} );

	describe( 'isProxyProcessRunning', () => {
		beforeEach( async () => {
			mockPm2.connect.mockImplementation( ( callback ) => {
				callback( null );
			} );
			await connect();
		} );

		it( 'should check for studio-proxy process', async () => {
			const mockProcess = {
				name: 'studio-proxy',
				pm_id: 1,
				pid: 99999,
				pm2_env: { status: 'online' },
			};

			mockPm2.list.mockImplementation( ( callback ) => {
				callback( null, [ mockProcess ] );
			} );

			const result = await isProxyProcessRunning();

			expect( result ).toEqual( {
				name: 'studio-proxy',
				pmId: 1,
				status: 'online',
				pid: 99999,
			} );
		} );

		it( 'should return undefined when proxy is not running', async () => {
			mockPm2.list.mockImplementation( ( callback ) => {
				callback( null, [] );
			} );

			const result = await isProxyProcessRunning();

			expect( result ).toBeUndefined();
		} );
	} );
} );
