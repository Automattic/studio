import { EventEmitter } from 'events';
import { vi } from 'vitest';
import { SiteData } from 'cli/lib/appdata';
import * as daemonClient from 'cli/lib/daemon-client';
import { DaemonBus } from 'cli/lib/daemon-client';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';

vi.mock( 'cli/lib/daemon-client' );

describe( 'WordPress Server Manager', () => {
	const mockLogger = {
		reportProgress: vi.fn(),
	} as unknown as Logger< string >;

	const mockSiteData: SiteData = {
		id: 'test-site-id',
		name: 'Test Site',
		path: '/test/site/path',
		port: 8881,
		phpVersion: '8.0',
		adminUsername: 'admin',
		adminPassword: 'password123',
		running: false,
	};

	const mockProcessDescription = {
		name: 'studio-site-test-site-id',
		pmId: 5,
		status: 'online',
		pid: 12345,
	} as const;

	let mockBus: EventEmitter;

	beforeEach( () => {
		vi.clearAllMocks();

		mockBus = new EventEmitter();

		vi.mocked( daemonClient.isProcessRunning ).mockResolvedValue( undefined );
		vi.mocked( daemonClient.startProcess ).mockResolvedValue( mockProcessDescription );
		vi.mocked( daemonClient.stopProcess ).mockResolvedValue( undefined );
		vi.mocked( daemonClient.getDaemonBus ).mockResolvedValue( mockBus as DaemonBus );
		vi.mocked( daemonClient.sendMessageToProcess ).mockReturnValue( Promise.resolve() );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	function setupIpcMocks(): void {
		// Emit "ready" repeatedly to avoid races where the listener is attached after one-shot emission.
		const readyInterval = setInterval( () => {
			mockBus.emit( 'process-message', {
				process: { name: mockProcessDescription.name, pm_id: mockProcessDescription.pmId },
				raw: { topic: 'ready' },
			} );
		}, 1 );

		vi.mocked( daemonClient.sendMessageToProcess ).mockImplementation( ( pmId, message ) => {
			clearInterval( readyInterval );
			// Send result message only after sendMessageToProcess is called
			setImmediate( () => {
				mockBus.emit( 'process-message', {
					process: { name: mockProcessDescription.name, pm_id: mockProcessDescription.pmId },
					raw: {
						topic: 'result',
						originalMessageId: message.messageId,
						result: {},
					},
				} );
			} );
			return Promise.resolve();
		} );
	}

	describe( 'isServerRunning', () => {
		it( 'should check if process is running with correct process name', async () => {
			const mockProcess = {
				name: 'studio-site-test-site-id',
				pmId: 5,
				status: 'online',
				pid: 12345,
			} as const;

			vi.mocked( daemonClient.isProcessRunning ).mockResolvedValue( mockProcess );

			const result = await isServerRunning( 'test-site-id' );

			expect( vi.mocked( daemonClient.isProcessRunning ) ).toHaveBeenCalledWith(
				'studio-site-test-site-id'
			);
			expect( result ).toEqual( mockProcess );
		} );

		it( 'should return undefined when process is not running', async () => {
			vi.mocked( daemonClient.isProcessRunning ).mockResolvedValue( undefined );

			const result = await isServerRunning( 'test-site-id' );

			expect( result ).toBeUndefined();
		} );
	} );

	describe( 'startWordPressServer', () => {
		it( 'should start WordPress server with basic configuration', async () => {
			setupIpcMocks();

			const result = await startWordPressServer( mockSiteData, mockLogger );

			expect( vi.mocked( daemonClient.startProcess ) ).toHaveBeenCalledWith(
				'studio-site-test-site-id',
				expect.stringContaining( 'wordpress-server-child.js' )
			);

			expect( result ).toEqual( mockProcessDescription );
		} );

		it( 'should handle start process failure', async () => {
			vi.mocked( daemonClient.startProcess ).mockRejectedValue(
				new Error( 'Failed to start process' )
			);

			await expect( startWordPressServer( mockSiteData, mockLogger ) ).rejects.toThrow(
				'Failed to start process'
			);
		} );
	} );

	describe( 'stopWordPressServer', () => {
		it( 'should stop WordPress server with correct process name', async () => {
			vi.mocked( daemonClient.isProcessRunning ).mockResolvedValue( {
				name: 'studio-site-test-site-id',
				pmId: 1,
				status: 'online',
				pid: 1234,
			} );

			vi.mocked( daemonClient.sendMessageToProcess ).mockImplementation( ( processId, message ) => {
				setImmediate( () => {
					mockBus.emit( 'process-message', {
						process: { name: 'studio-site-test-site-id', pm_id: 1 },
						raw: {
							topic: 'result',
							originalMessageId: message.messageId,
						},
					} );
				} );

				return Promise.resolve();
			} );

			const promise = stopWordPressServer( 'test-site-id' );

			setTimeout( () => {
				mockBus.emit( 'process-event', {
					process: { name: 'studio-site-test-site-id', pm_id: 1 },
					event: 'exit',
				} );
			}, 500 );

			await promise;

			expect( vi.mocked( daemonClient.stopProcess ) ).not.toHaveBeenCalled();
		} );

		it( 'should propagate errors from fallback `stopProcess` call', async () => {
			vi.mocked( daemonClient.isProcessRunning ).mockResolvedValue( {
				name: 'studio-site-test-site-id',
				pmId: 1,
				status: 'online',
				pid: 1234,
			} );
			vi.mocked( daemonClient.sendMessageToProcess ).mockRejectedValue(
				new Error( 'Failed to send stop message' )
			);
			vi.mocked( daemonClient.stopProcess ).mockRejectedValue(
				new Error( 'Failed to stop process' )
			);

			await expect( stopWordPressServer( 'test-site-id' ) ).rejects.toThrow(
				'Failed to stop process'
			);
		} );
	} );
} );
