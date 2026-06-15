import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { STUDIO_ERROR_LOG_FILENAME } from '@studio/common/lib/mu-plugins';
import { SITE_RUNTIME_NATIVE_PHP, SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import { vi } from 'vitest';
import { SiteData } from 'cli/lib/cli-config/core';
import * as daemonClient from 'cli/lib/daemon-client';
import { DaemonBus } from 'cli/lib/daemon-client';
import { ensurePhpBinaryAvailable } from 'cli/lib/dependency-management/php-binary';
import {
	isServerRunning,
	sendWpCliCommand,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';

vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'cli/lib/dependency-management/php-binary', () => ( {
	ensurePhpBinaryAvailable: vi.fn().mockResolvedValue( undefined ),
} ) );

describe( 'WordPress Server Manager', () => {
	const mockLogger = {
		reportProgress: vi.fn(),
		reportStart: vi.fn(),
		reportWarning: vi.fn(),
	} as unknown as Logger< string >;

	const mockSiteData: SiteData = {
		id: 'test-site-id',
		name: 'Test Site',
		path: '/test/site/path',
		port: 8881,
		phpVersion: '8.4',
		adminUsername: 'admin',
		adminPassword: 'password123',
		running: false,
	};

	const mockProcessDescription = {
		name: 'studio-site-test-site-id',
		pmId: 5,
		status: 'online',
		pid: 12345,
		runtime: SITE_RUNTIME_PLAYGROUND,
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
		vi.unstubAllEnvs();
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
				runtime: SITE_RUNTIME_PLAYGROUND,
			} as const;

			vi.mocked( daemonClient.isProcessRunning ).mockResolvedValue( mockProcess );

			const result = await isServerRunning( 'test-site-id' );

			expect( vi.mocked( daemonClient.isProcessRunning ) ).toHaveBeenCalledWith(
				'studio-site-test-site-id'
			);
			expect( result ).toEqual( mockProcess );
		} );

		it( 'should preserve runtime from a running site process', async () => {
			const mockProcess = {
				name: 'studio-site-test-site-id',
				pmId: 5,
				status: 'online',
				pid: 12345,
				runtime: SITE_RUNTIME_NATIVE_PHP,
			} as const;

			vi.mocked( daemonClient.isProcessRunning ).mockResolvedValue( mockProcess );

			const result = await isServerRunning( 'test-site-id' );

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
				expect.stringMatching( /playground-server-child\.mjs$/ ),
				{ runtime: SITE_RUNTIME_PLAYGROUND }
			);

			expect( result ).toEqual( mockProcessDescription );
		} );

		it( 'should use the native-php child script when STUDIO_RUNTIME is native-php', async () => {
			vi.stubEnv( 'STUDIO_RUNTIME', SITE_RUNTIME_NATIVE_PHP );
			setupIpcMocks();

			await startWordPressServer( mockSiteData, mockLogger );

			expect( vi.mocked( daemonClient.startProcess ) ).toHaveBeenCalledWith(
				'studio-site-test-site-id',
				expect.stringMatching( /php-server-child\.mjs$/ ),
				{ runtime: SITE_RUNTIME_NATIVE_PHP }
			);
		} );

		it( 'should resolve older stored PHP versions to the closest native PHP version when starting native PHP', async () => {
			vi.stubEnv( 'STUDIO_RUNTIME', SITE_RUNTIME_NATIVE_PHP );
			setupIpcMocks();

			await startWordPressServer( { ...mockSiteData, phpVersion: '7.4' }, mockLogger );

			expect( vi.mocked( ensurePhpBinaryAvailable ) ).toHaveBeenCalledWith(
				'8.2',
				expect.any( Function )
			);
			expect( vi.mocked( daemonClient.sendMessageToProcess ) ).toHaveBeenCalledWith(
				mockProcessDescription.pmId,
				expect.objectContaining( {
					topic: 'start-server',
					data: expect.objectContaining( {
						config: expect.objectContaining( { phpVersion: '8.2' } ),
					} ),
				} )
			);
		} );

		it( 'should use the playground child script when STUDIO_RUNTIME is unset', async () => {
			setupIpcMocks();

			await startWordPressServer( mockSiteData, mockLogger );

			expect( vi.mocked( daemonClient.startProcess ) ).toHaveBeenCalledWith(
				'studio-site-test-site-id',
				expect.stringMatching( /playground-server-child\.mjs$/ ),
				{ runtime: SITE_RUNTIME_PLAYGROUND }
			);
		} );

		it( 'should handle start process failure', async () => {
			vi.mocked( daemonClient.startProcess ).mockRejectedValue(
				new Error( 'Failed to start process' )
			);

			await expect( startWordPressServer( mockSiteData, mockLogger ) ).rejects.toThrow(
				'Failed to start process'
			);
		} );

		it( 'should surface an error when the child process exits before becoming ready', async () => {
			// Do not emit `ready`; instead emit an `exit` event to simulate a crash during startup.
			setTimeout( () => {
				mockBus.emit( 'process-event', {
					process: {
						name: mockProcessDescription.name,
						pm_id: mockProcessDescription.pmId,
					},
					event: 'exit',
				} );
			}, 10 );

			await expect( startWordPressServer( mockSiteData, mockLogger ) ).rejects.toThrow(
				/exited before becoming ready/
			);
		} );

		it( 'should include the child stderr tail in the error when the daemon provides it', async () => {
			const stderrTail = 'SyntaxError: The requested module did not provide an export named X';

			setTimeout( () => {
				mockBus.emit( 'process-event', {
					process: {
						name: mockProcessDescription.name,
						pm_id: mockProcessDescription.pmId,
					},
					event: 'exit',
					stderrTail,
				} );
			}, 10 );

			await expect( startWordPressServer( mockSiteData, mockLogger ) ).rejects.toThrow(
				new RegExp( stderrTail.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) )
			);
		} );

		it( 'should catch exit events fired before startProcess resolves', async () => {
			// Simulate an exit that fires while `startProcess` is still in flight, *before*
			// the caller knows the pmId. Listeners must be attached ahead of startProcess for
			// this to work.
			vi.mocked( daemonClient.startProcess ).mockImplementation( async () => {
				setTimeout( () => {
					mockBus.emit( 'process-event', {
						process: {
							name: mockProcessDescription.name,
							pm_id: mockProcessDescription.pmId,
						},
						event: 'exit',
						stderrTail: 'early crash',
					} );
				}, 0 );
				await new Promise( ( resolve ) => setTimeout( resolve, 20 ) );
				return mockProcessDescription;
			} );

			await expect( startWordPressServer( mockSiteData, mockLogger ) ).rejects.toThrow(
				/early crash/
			);
		} );

		it( 'should append PHP errors captured during the start attempt to the failure', async () => {
			const sitePath = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-test-site-' ) );
			await fs.promises.mkdir( path.join( sitePath, 'wp-content' ), { recursive: true } );
			const logPath = path.join( sitePath, 'wp-content', STUDIO_ERROR_LOG_FILENAME );

			setTimeout( () => {
				fs.writeFileSync( logPath, 'PHP Fatal error: Uncaught Error: Failed opening required' );
				mockBus.emit( 'process-event', {
					process: {
						name: mockProcessDescription.name,
						pm_id: mockProcessDescription.pmId,
					},
					event: 'exit',
				} );
			}, 10 );

			await expect(
				startWordPressServer( { ...mockSiteData, path: sitePath }, mockLogger )
			).rejects.toThrow( /Recent PHP errors[\s\S]*PHP Fatal error/ );
		} );

		it( 'should not append stale PHP errors from a previous run', async () => {
			const sitePath = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-test-site-' ) );
			await fs.promises.mkdir( path.join( sitePath, 'wp-content' ), { recursive: true } );
			// debug.log isn't cleared on start, so stale entries are filtered by mtime.
			const logPath = path.join( sitePath, 'wp-content', 'debug.log' );
			fs.writeFileSync( logPath, 'PHP Fatal error: from a previous run' );
			const past = new Date( Date.now() - 60_000 );
			fs.utimesSync( logPath, past, past );

			setTimeout( () => {
				mockBus.emit( 'process-event', {
					process: {
						name: mockProcessDescription.name,
						pm_id: mockProcessDescription.pmId,
					},
					event: 'exit',
				} );
			}, 10 );

			const error: Error = await startWordPressServer(
				{ ...mockSiteData, path: sitePath, enableDebugLog: true },
				mockLogger
			).then(
				() => {
					throw new Error( 'expected startWordPressServer to reject' );
				},
				( e ) => e
			);
			expect( error.message ).toContain( 'exited before becoming ready' );
			expect( error.message ).not.toContain( 'Recent PHP errors' );
		} );

		it( 'should append PHP errors from debug.log when the debug-log setting is on', async () => {
			const sitePath = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-test-site-' ) );
			await fs.promises.mkdir( path.join( sitePath, 'wp-content' ), { recursive: true } );
			const logPath = path.join( sitePath, 'wp-content', 'debug.log' );

			setTimeout( () => {
				fs.writeFileSync( logPath, 'PHP Fatal error: Uncaught Error: Failed opening required' );
				mockBus.emit( 'process-event', {
					process: {
						name: mockProcessDescription.name,
						pm_id: mockProcessDescription.pmId,
					},
					event: 'exit',
				} );
			}, 10 );

			await expect(
				startWordPressServer(
					{ ...mockSiteData, path: sitePath, enableDebugLog: true },
					mockLogger
				)
			).rejects.toThrow( /Recent PHP errors[\s\S]*debug\.log[\s\S]*PHP Fatal error/ );
		} );

		it( 'should clear the studio error log from a previous run before starting', async () => {
			setupIpcMocks();
			const sitePath = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-test-site-' ) );
			await fs.promises.mkdir( path.join( sitePath, 'wp-content' ), { recursive: true } );
			const logPath = path.join( sitePath, 'wp-content', STUDIO_ERROR_LOG_FILENAME );
			fs.writeFileSync( logPath, 'PHP Fatal error: from a previous run' );

			await startWordPressServer( { ...mockSiteData, path: sitePath }, mockLogger );

			expect( fs.existsSync( logPath ) ).toBe( false );
		} );
	} );

	describe( 'sendWpCliCommand', () => {
		it( 'should send WP-CLI commands to a running playground process', async () => {
			vi.mocked( daemonClient.isProcessRunning ).mockResolvedValue( {
				name: 'studio-site-test-site-id',
				pmId: 1,
				status: 'online',
				pid: 1234,
				runtime: SITE_RUNTIME_PLAYGROUND,
			} );

			vi.mocked( daemonClient.sendMessageToProcess ).mockImplementation( ( processId, message ) => {
				setImmediate( () => {
					mockBus.emit( 'process-message', {
						process: { name: 'studio-site-test-site-id', pm_id: processId },
						raw: {
							topic: 'result',
							originalMessageId: message.messageId,
							result: { stdout: 'ok', stderr: '', exitCode: 0 },
						},
					} );
				} );

				return Promise.resolve();
			} );

			await expect(
				sendWpCliCommand( 'test-site-id', [ 'option', 'get', 'siteurl' ] )
			).resolves.toEqual( { stdout: 'ok', stderr: '', exitCode: 0 } );
		} );

		it( 'should not send WP-CLI commands to a running native PHP process', async () => {
			vi.mocked( daemonClient.isProcessRunning ).mockResolvedValue( {
				name: 'studio-site-test-site-id',
				pmId: 1,
				status: 'online',
				pid: 1234,
				runtime: SITE_RUNTIME_NATIVE_PHP,
			} );

			await expect(
				sendWpCliCommand( 'test-site-id', [ 'option', 'get', 'siteurl' ] )
			).rejects.toThrow( 'Running WordPress server does not support WP-CLI commands' );

			expect( vi.mocked( daemonClient.sendMessageToProcess ) ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'stopWordPressServer', () => {
		it( 'should stop WordPress server with correct process name', async () => {
			vi.mocked( daemonClient.isProcessRunning ).mockResolvedValue( {
				name: 'studio-site-test-site-id',
				pmId: 1,
				status: 'online',
				pid: 1234,
				runtime: SITE_RUNTIME_PLAYGROUND,
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
				runtime: SITE_RUNTIME_PLAYGROUND,
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
