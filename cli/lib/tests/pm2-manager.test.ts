import os from 'os';
import { clearCache } from 'common/lib/cache-function-ttl';
import { getAppdataPath } from 'cli/lib/appdata';
import { ManagerMessage } from '../types/wordpress-server-ipc';

jest.mock( 'fs' );
jest.mock( 'os', () => ( {
	homedir: jest.fn().mockReturnValue( '/home/user' ),
} ) );
jest.mock( 'cli/lib/appdata', () => ( {
	getAppdataPath: jest.fn().mockReturnValue( '/home/user/.studio/appdata' ),
} ) );

const mockPm2Instance = {
	connect: jest.fn(),
	disconnect: jest.fn(),
	list: jest.fn(),
	start: jest.fn(),
	delete: jest.fn(),
	launchBus: jest.fn(),
	sendDataToProcessId: jest.fn(),
};

jest.mock( 'pm2', () => {
	return {
		custom: jest.fn().mockImplementation( () => mockPm2Instance ),
	};
} );

describe( 'PM2 Manager', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		clearCache();
		( os.homedir as jest.Mock ).mockReturnValue( '/home/user' );
		( getAppdataPath as jest.Mock ).mockReturnValue( '/home/user/.studio/appdata' );
	} );

	describe( 'connect() - timeout handling and idempotency', () => {
		it( 'should timeout after 10 seconds if PM2 does not respond', async () => {
			jest.useFakeTimers();
			mockPm2Instance.connect.mockImplementation( () => {
				// Never call callback
			} );

			const { connect } = await import( '../pm2-manager' );
			const connectPromise = connect();
			jest.advanceTimersByTime( 10000 );

			await expect( connectPromise ).rejects.toThrow( 'PM2 connection timeout after 10 seconds' );

			jest.useRealTimers();
		} );

		it( 'should not call pm2.connect again if already connected', async () => {
			mockPm2Instance.connect.mockImplementation( ( callback ) => {
				callback( null );
			} );
			const { connect } = await import( '../pm2-manager' );

			await connect();
			await connect();
			await connect();

			expect( mockPm2Instance.connect ).toHaveBeenCalledTimes( 1 );
		} );
	} );

	describe( 'startProcess() - response validation and transformation', () => {
		it( 'should validate PM2 response structure and reject incomplete responses', async () => {
			mockPm2Instance.start.mockImplementation( ( config, callback ) => {
				callback( null, [] );
			} );

			const { startProcess } = await import( '../pm2-manager' );

			await expect( startProcess( 'app', '/path/script.js' ) ).rejects.toThrow(
				'PM2 returned incomplete response'
			);
		} );

		it( 'should reject if PM2 response missing pm2_env', async () => {
			mockPm2Instance.start.mockImplementation( ( config, callback ) => {
				callback( null, [ { pid: 1234 } ] );
			} );

			const { startProcess } = await import( '../pm2-manager' );

			await expect( startProcess( 'app', '/path/script.js' ) ).rejects.toThrow(
				'PM2 returned incomplete response'
			);
		} );

		it( 'should reject if pm2_env.pm_id is undefined', async () => {
			mockPm2Instance.start.mockImplementation( ( config, callback ) => {
				callback( null, [
					{ pm2_env: { status: 'online' }, pid: 1234 }, // Missing pm_id
				] );
			} );

			const { startProcess } = await import( '../pm2-manager' );

			await expect( startProcess( 'app', '/path/script.js' ) ).rejects.toThrow(
				'PM2 returned incomplete response'
			);
		} );

		it( 'should transform valid PM2 response to ProcessDescription', async () => {
			mockPm2Instance.start.mockImplementation( ( config, callback ) => {
				callback( null, [
					{
						pm2_env: { pm_id: 5, status: 'online' },
						pid: 9999,
					},
				] );
			} );

			const { startProcess } = await import( '../pm2-manager' );
			const result = await startProcess( 'my-app', '/path/script.js' );

			expect( result ).toEqual( {
				name: 'my-app',
				pmId: 5,
				status: 'online',
				pid: 9999,
			} );
		} );
	} );

	describe( 'stopProcess() - graceful error handling', () => {
		it( 'should swallow "process not found" error without rejecting', async () => {
			mockPm2Instance.delete.mockImplementation( ( name, callback ) => {
				callback( new Error( 'process name not found' ) );
			} );

			const { stopProcess } = await import( '../pm2-manager' );

			await expect( stopProcess( 'non-existent' ) ).resolves.toBeUndefined();
		} );

		it( 'should reject on other delete errors', async () => {
			mockPm2Instance.delete.mockImplementation( ( name, callback ) => {
				callback( new Error( 'Permission denied' ) );
			} );

			const { stopProcess } = await import( '../pm2-manager' );

			await expect( stopProcess( 'app' ) ).rejects.toThrow( 'Permission denied' );
		} );
	} );

	describe( 'isProcessRunning() - process discovery and filtering', () => {
		it( 'should return undefined when not connected', async () => {
			const { isProcessRunning, disconnect } = await import( '../pm2-manager' );
			disconnect();

			const result = await isProcessRunning( 'app' );

			expect( result ).toBeUndefined();
			expect( mockPm2Instance.list ).not.toHaveBeenCalled();
		} );

		it( 'should filter for online status only', async () => {
			mockPm2Instance.list.mockImplementation( ( callback ) => {
				callback( null, [
					{
						name: 'app',
						pm_id: 1,
						pid: 1000,
						pm2_env: { status: 'stopped' },
					},
				] );
			} );

			const { isProcessRunning, connect } = await import( '../pm2-manager' );
			await connect();

			const result = await isProcessRunning( 'app' );

			expect( result ).toBeUndefined();
		} );

		it( 'should return process with online status and transform data', async () => {
			mockPm2Instance.list.mockImplementation( ( callback ) => {
				callback( null, [
					{
						name: 'app',
						pm_id: 2,
						pid: 2000,
						pm2_env: { status: 'online' },
					},
				] );
			} );

			const { isProcessRunning, connect } = await import( '../pm2-manager' );
			await connect();

			const result = await isProcessRunning( 'app' );

			expect( result ).toEqual( {
				name: 'app',
				pmId: 2,
				status: 'online',
				pid: 2000,
			} );
		} );

		it( 'should handle pm2.list errors gracefully', async () => {
			const consoleErrorSpy = jest.spyOn( console, 'error' ).mockImplementation();
			mockPm2Instance.list.mockImplementation( ( callback ) => {
				callback( new Error( 'List error' ) );
			} );

			const { isProcessRunning, connect } = await import( '../pm2-manager' );
			await connect();

			const result = await isProcessRunning( 'app' );

			expect( result ).toBeUndefined();
			expect( consoleErrorSpy ).toHaveBeenCalled();
			consoleErrorSpy.mockRestore();
		} );
	} );

	describe( 'listProcesses caching', () => {
		it( 'should cache results to avoid multiple pm2.list calls', async () => {
			mockPm2Instance.list.mockImplementation( ( callback ) => {
				callback( null, [] );
			} );

			const { isProcessRunning, connect } = await import( '../pm2-manager' );
			await connect();

			await isProcessRunning( 'app1' );
			await isProcessRunning( 'app2' );
			await isProcessRunning( 'app3' );

			expect( mockPm2Instance.list ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'should invalidate cache after clearCache is called', async () => {
			mockPm2Instance.list.mockImplementation( ( callback ) => {
				callback( null, [] );
			} );

			const { isProcessRunning, connect } = await import( '../pm2-manager' );
			await connect();

			await isProcessRunning( 'app1' );
			clearCache();
			await isProcessRunning( 'app2' );

			expect( mockPm2Instance.list ).toHaveBeenCalledTimes( 2 );
		} );
	} );

	describe( 'getPm2Bus() - bus caching', () => {
		it( 'should cache bus instance to avoid multiple launchBus calls', async () => {
			const mockBus = { on: jest.fn() };
			mockPm2Instance.launchBus.mockImplementation( ( callback ) => {
				callback( null, mockBus );
			} );

			const { getPm2Bus, connect } = await import( '../pm2-manager' );
			await connect();

			const bus1 = await getPm2Bus();
			const bus2 = await getPm2Bus();

			expect( bus1 ).toBe( bus2 );
			expect( mockPm2Instance.launchBus ).toHaveBeenCalledTimes( 1 );
		} );
	} );

	describe( 'sendMessageToProcess()', () => {
		it( 'should send message with correct processId and data', async () => {
			mockPm2Instance.sendDataToProcessId.mockImplementation( ( id, data, callback ) => {
				callback( null );
			} );

			const { sendMessageToProcess } = await import( '../pm2-manager' );

			const message: ManagerMessage = {
				topic: 'stop-server',
				messageId: 1,
				data: {},
			};

			await sendMessageToProcess( 42, message );

			expect( mockPm2Instance.sendDataToProcessId ).toHaveBeenCalledWith(
				42,
				message,
				expect.any( Function )
			);
		} );

		it( 'should reject on send error', async () => {
			mockPm2Instance.sendDataToProcessId.mockImplementation( ( id, data, callback ) => {
				callback( new Error( 'Send failed' ) );
			} );

			const { sendMessageToProcess } = await import( '../pm2-manager' );

			const message: ManagerMessage = {
				topic: 'stop-server',
				messageId: 1,
				data: {},
			};

			await expect( sendMessageToProcess( 42, message ) ).rejects.toThrow( 'Send failed' );
		} );
	} );
} );
