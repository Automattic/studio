// Mock the pm2-manager module BEFORE importing wordpress-server-manager
jest.mock( 'cli/lib/pm2-manager', () => ( {
	getPm2Bus: jest.fn(),
	sendMessageToProcess: jest.fn(),
	isProcessRunning: jest.fn(),
	startProcess: jest.fn(),
	stopProcess: jest.fn(),
} ) );

import { EventEmitter } from 'events';
import { SiteData } from 'cli/lib/appdata';
import * as pm2Manager from 'cli/lib/pm2-manager';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';

describe( 'WordPress Server Manager', () => {
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
		jest.clearAllMocks();

		mockBus = new EventEmitter();

		( pm2Manager.isProcessRunning as jest.Mock ).mockResolvedValue( undefined );
		( pm2Manager.startProcess as jest.Mock ).mockResolvedValue( mockProcessDescription );
		( pm2Manager.stopProcess as jest.Mock ).mockResolvedValue( undefined );
		( pm2Manager.getPm2Bus as jest.Mock ).mockResolvedValue( mockBus as unknown as EventEmitter );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	function setupIpcMocks( resultValue: unknown = {} ): void {
		// Send ready message after a tick (simulating async bus initialization)
		process.nextTick( () => {
			mockBus.emit( 'process:msg', {
				process: { pm_id: mockProcessDescription.pmId },
				raw: { topic: 'ready' },
			} );
		} );

		( pm2Manager.sendMessageToProcess as jest.Mock ).mockImplementation( ( pmId, message ) => {
			// Send result message only after sendMessageToProcess is called
			process.nextTick( () => {
				mockBus.emit( 'process:msg', {
					process: { pm_id: mockProcessDescription.pmId },
					raw: {
						topic: 'result',
						originalMessageId: message.messageId,
						result: resultValue,
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

			( pm2Manager.isProcessRunning as jest.Mock ).mockResolvedValue( mockProcess );

			const result = await isServerRunning( 'test-site-id' );

			expect( pm2Manager.isProcessRunning as jest.Mock ).toHaveBeenCalledWith(
				'studio-site-test-site-id'
			);
			expect( result ).toEqual( mockProcess );
		} );

		it( 'should return undefined when process is not running', async () => {
			( pm2Manager.isProcessRunning as jest.Mock ).mockResolvedValue( undefined );

			const result = await isServerRunning( 'test-site-id' );

			expect( result ).toBeUndefined();
		} );
	} );

	describe( 'startWordPressServer', () => {
		it( 'should start WordPress server with basic configuration', async () => {
			setupIpcMocks( { success: true } );

			const result = await startWordPressServer( mockSiteData );

			expect( pm2Manager.startProcess as jest.Mock ).toHaveBeenCalledWith(
				'studio-site-test-site-id',
				expect.stringContaining( 'wordpress-server-child.js' ),
				expect.objectContaining( {
					STUDIO_WORDPRESS_SERVER_CONFIG: expect.any( String ),
				} )
			);

			const callArgs = ( pm2Manager.startProcess as jest.Mock ).mock.calls[ 0 ];
			const configJson = JSON.parse( callArgs[ 2 ].STUDIO_WORDPRESS_SERVER_CONFIG );
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

			await startWordPressServer( {
				...mockSiteData,
				customDomain: 'testsite.local',
			} );

			const callArgs = ( pm2Manager.startProcess as jest.Mock ).mock.calls[ 0 ];
			const configJson = JSON.parse( callArgs[ 2 ].STUDIO_WORDPRESS_SERVER_CONFIG );
			expect( configJson.absoluteUrl ).toBe( 'http://testsite.local' );
		} );

		it( 'should start WordPress server with custom domain (HTTPS)', async () => {
			setupIpcMocks();

			await startWordPressServer( {
				...mockSiteData,
				customDomain: 'testsite.local',
				enableHttps: true,
			} );

			const callArgs = ( pm2Manager.startProcess as jest.Mock ).mock.calls[ 0 ];
			const configJson = JSON.parse( callArgs[ 2 ].STUDIO_WORDPRESS_SERVER_CONFIG );
			expect( configJson.absoluteUrl ).toBe( 'https://testsite.local' );
		} );

		it( 'should handle PM2 start process failure', async () => {
			( pm2Manager.startProcess as jest.Mock ).mockRejectedValue(
				new Error( 'Failed to start PM2 process' )
			);

			await expect( startWordPressServer( mockSiteData ) ).rejects.toThrow(
				'Failed to start PM2 process'
			);
		} );

		it( 'should send correct config via environment variable', async () => {
			setupIpcMocks();

			const siteWithOptions: SiteData = {
				...mockSiteData,
				isWpAutoUpdating: false,
			};

			await startWordPressServer( siteWithOptions );

			const callArgs = ( pm2Manager.startProcess as jest.Mock ).mock.calls[ 0 ];
			const configJson = JSON.parse( callArgs[ 2 ].STUDIO_WORDPRESS_SERVER_CONFIG );
			expect( configJson.isWpAutoUpdating ).toBe( false );
		} );
	} );

	describe( 'stopWordPressServer', () => {
		it( 'should stop WordPress server with correct process name', async () => {
			await stopWordPressServer( 'test-site-id' );

			expect( pm2Manager.stopProcess as jest.Mock ).toHaveBeenCalledWith(
				'studio-site-test-site-id'
			);
		} );

		it( 'should propagate stopProcess errors', async () => {
			( pm2Manager.stopProcess as jest.Mock ).mockRejectedValue(
				new Error( 'Failed to stop process' )
			);

			await expect( stopWordPressServer( 'test-site-id' ) ).rejects.toThrow(
				'Failed to stop process'
			);
		} );
	} );
} );
