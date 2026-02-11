import { EventEmitter } from 'events';
import { vi } from 'vitest';
// Mock the pm2-manager module BEFORE importing wordpress-server-manager
vi.mock( 'cli/lib/pm2-manager' );
import { SiteData } from 'cli/lib/appdata';
import * as pm2Manager from 'cli/lib/pm2-manager';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';

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
	};

	let mockBus: EventEmitter;

	beforeEach( () => {
		vi.clearAllMocks();

		mockBus = new EventEmitter();

		vi.mocked( pm2Manager.isProcessRunning ).mockResolvedValue( undefined );
		vi.mocked( pm2Manager.startProcess ).mockResolvedValue( mockProcessDescription );
		vi.mocked( pm2Manager.stopProcess ).mockResolvedValue( undefined );
		vi.mocked( pm2Manager.getPm2Bus ).mockResolvedValue( mockBus );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	function setupIpcMocks(): void {
		// Send ready message after a tick (simulating async bus initialization)
		process.nextTick( () => {
			mockBus.emit( 'process:msg', {
				process: { name: mockProcessDescription.name, pm_id: mockProcessDescription.pmId },
				raw: { topic: 'ready' },
			} );
		} );

		vi.mocked( pm2Manager.sendMessageToProcess ).mockImplementation( ( pmId, message ) => {
			// Send result message only after sendMessageToProcess is called
			process.nextTick( () => {
				mockBus.emit( 'process:msg', {
					process: { name: mockProcessDescription.name, pm_id: mockProcessDescription.pmId },
					raw: {
						topic: 'result',
						originalMessageId: message.messageId,
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
			};

			vi.mocked( pm2Manager.isProcessRunning ).mockResolvedValue( mockProcess );

			const result = await isServerRunning( 'test-site-id' );

			expect( vi.mocked( pm2Manager.isProcessRunning ) ).toHaveBeenCalledWith(
				'studio-site-test-site-id'
			);
			expect( result ).toEqual( mockProcess );
		} );

		it( 'should return undefined when process is not running', async () => {
			vi.mocked( pm2Manager.isProcessRunning ).mockResolvedValue( undefined );

			const result = await isServerRunning( 'test-site-id' );

			expect( result ).toBeUndefined();
		} );
	} );

	describe( 'startWordPressServer', () => {
		it( 'should start WordPress server with basic configuration', async () => {
			setupIpcMocks();

			const result = await startWordPressServer( mockSiteData, mockLogger );

			expect( vi.mocked( pm2Manager.startProcess ) ).toHaveBeenCalledWith(
				'studio-site-test-site-id',
				expect.stringContaining( 'wordpress-server-child.js' ),
				expect.objectContaining( {
					STUDIO_WORDPRESS_SERVER_CONFIG: expect.any( String ),
				} )
			);

			const callArgs = vi.mocked( pm2Manager.startProcess ).mock.calls[ 0 ];
			const configJson = JSON.parse( callArgs[ 2 ]!.STUDIO_WORDPRESS_SERVER_CONFIG );
			expect( configJson ).toEqual(
				expect.objectContaining( {
					siteId: 'test-site-id',
					sitePath: '/test/site/path',
					port: 8881,
					phpVersion: '8.0',
					siteTitle: 'Test Site',
					adminPassword: 'password123',
				} )
			);

			expect( result ).toEqual( mockProcessDescription );
		} );

		it( 'should start WordPress server with custom domain (HTTP)', async () => {
			setupIpcMocks();

			await startWordPressServer(
				{
					...mockSiteData,
					customDomain: 'testsite.local',
				},
				mockLogger
			);

			const callArgs = vi.mocked( pm2Manager.startProcess ).mock.calls[ 0 ];
			const configJson = JSON.parse( callArgs[ 2 ]!.STUDIO_WORDPRESS_SERVER_CONFIG );
			expect( configJson.absoluteUrl ).toBe( 'http://testsite.local' );
		} );

		it( 'should start WordPress server with custom domain (HTTPS)', async () => {
			setupIpcMocks();

			await startWordPressServer(
				{
					...mockSiteData,
					customDomain: 'testsite.local',
					enableHttps: true,
				},
				mockLogger
			);

			const callArgs = vi.mocked( pm2Manager.startProcess ).mock.calls[ 0 ];
			const configJson = JSON.parse( callArgs[ 2 ]!.STUDIO_WORDPRESS_SERVER_CONFIG );
			expect( configJson.absoluteUrl ).toBe( 'https://testsite.local' );
		} );

		it( 'should handle PM2 start process failure', async () => {
			vi.mocked( pm2Manager.startProcess ).mockRejectedValue(
				new Error( 'Failed to start PM2 process' )
			);

			await expect( startWordPressServer( mockSiteData, mockLogger ) ).rejects.toThrow(
				'Failed to start PM2 process'
			);
		} );

		it( 'should send correct config via environment variable', async () => {
			setupIpcMocks();

			const siteWithOptions: SiteData = {
				...mockSiteData,
				isWpAutoUpdating: false,
			};

			await startWordPressServer( siteWithOptions, mockLogger );

			const callArgs = vi.mocked( pm2Manager.startProcess ).mock.calls[ 0 ];
			const configJson = JSON.parse( callArgs[ 2 ]!.STUDIO_WORDPRESS_SERVER_CONFIG );
			expect( configJson.isWpAutoUpdating ).toBe( false );
		} );
	} );

	describe( 'stopWordPressServer', () => {
		it( 'should stop WordPress server with correct process name', async () => {
			await stopWordPressServer( 'test-site-id' );

			expect( vi.mocked( pm2Manager.stopProcess ) ).toHaveBeenCalledWith(
				'studio-site-test-site-id'
			);
		} );

		it( 'should propagate stopProcess errors', async () => {
			vi.mocked( pm2Manager.stopProcess ).mockRejectedValue(
				new Error( 'Failed to stop process' )
			);

			await expect( stopWordPressServer( 'test-site-id' ) ).rejects.toThrow(
				'Failed to stop process'
			);
		} );
	} );
} );
