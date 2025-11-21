import { SiteData } from 'cli/lib/appdata';

// Mock PM2 instance - must be defined before mocking pm2-manager
const mockPm2 = {
	launchBus: jest.fn(),
	sendDataToProcessId: jest.fn(),
};

// Mock the pm2-manager module BEFORE importing wordpress-server-manager
jest.mock( 'cli/lib/pm2-manager', () => ( {
	getPm2Instance: jest.fn( () => mockPm2 ),
	isProcessRunning: jest.fn(),
	startProcess: jest.fn(),
	stopProcess: jest.fn(),
} ) );

import * as pm2Manager from 'cli/lib/pm2-manager';

// Import after mocks are set up
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from '../wordpress-server-manager';

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

	const mockSiteDataWithCustomDomain: SiteData = {
		...mockSiteData,
		customDomain: 'testsite.local',
	};

	const mockSiteDataWithHttps: SiteData = {
		...mockSiteDataWithCustomDomain,
		enableHttps: true,
	};

	const mockProcessDescription = {
		name: 'studio-site-test-site-id',
		pmId: 5,
		status: 'online',
		pid: 12345,
	};

	let mockBus: {
		on: jest.Mock;
		off: jest.Mock;
	};

	beforeEach( () => {
		jest.clearAllMocks();

		// Setup mock bus
		mockBus = {
			on: jest.fn(),
			off: jest.fn(),
		};

		// Setup pm2-manager mocks (functions already mocked at module level)
		( pm2Manager.isProcessRunning as jest.Mock ).mockResolvedValue( undefined );
		( pm2Manager.startProcess as jest.Mock ).mockResolvedValue( mockProcessDescription );
		( pm2Manager.stopProcess as jest.Mock ).mockResolvedValue( undefined );

		// Setup pm2.launchBus mock
		mockPm2.launchBus.mockImplementation( ( callback ) => {
			callback( null, mockBus );
		} );

		// Setup pm2.sendDataToProcessId mock
		mockPm2.sendDataToProcessId.mockImplementation( ( pmId, message, callback ) => {
			callback( null );
		} );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

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

			expect( pm2Manager.isProcessRunning ).toHaveBeenCalledWith( 'studio-site-test-site-id' );
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
			mockBus.on.mockImplementation( ( event, handler ) => {
				if ( event === 'process:msg' ) {
					process.nextTick( () => {
						handler( {
							process: { pm_id: mockProcessDescription.pmId },
							raw: { topic: 'ready' },
						} );
						process.nextTick( () => {
							handler( {
								process: { pm_id: mockProcessDescription.pmId },
								raw: { topic: 'result', siteId: mockSiteData.id, result: { success: true } },
							} );
						} );
					} );
				}
			} );

			const result = await startWordPressServer( mockSiteData );

			expect( pm2Manager.startProcess ).toHaveBeenCalledWith(
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
			mockBus.on.mockImplementation( ( event, handler ) => {
				if ( event === 'process:msg' ) {
					process.nextTick( () => {
						handler( {
							process: { pm_id: mockProcessDescription.pmId },
							raw: { topic: 'ready' },
						} );
						process.nextTick( () => {
							handler( {
								process: { pm_id: mockProcessDescription.pmId },
								raw: { topic: 'result', siteId: mockSiteDataWithCustomDomain.id, result: {} },
							} );
						} );
					} );
				}
			} );

			await startWordPressServer( mockSiteDataWithCustomDomain );

			const callArgs = ( pm2Manager.startProcess as jest.Mock ).mock.calls[ 0 ];
			const configJson = JSON.parse( callArgs[ 2 ].STUDIO_WORDPRESS_SERVER_CONFIG );
			expect( configJson.absoluteUrl ).toBe( 'http://testsite.local' );
		} );

		it( 'should start WordPress server with custom domain (HTTPS)', async () => {
			mockBus.on.mockImplementation( ( event, handler ) => {
				if ( event === 'process:msg' ) {
					process.nextTick( () => {
						handler( {
							process: { pm_id: mockProcessDescription.pmId },
							raw: { topic: 'ready' },
						} );
						process.nextTick( () => {
							handler( {
								process: { pm_id: mockProcessDescription.pmId },
								raw: { topic: 'result', siteId: mockSiteDataWithHttps.id, result: {} },
							} );
						} );
					} );
				}
			} );

			await startWordPressServer( mockSiteDataWithHttps );

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
			mockBus.on.mockImplementation( ( event, handler ) => {
				if ( event === 'process:msg' ) {
					process.nextTick( () => {
						handler( {
							process: { pm_id: mockProcessDescription.pmId },
							raw: { topic: 'ready' },
						} );
						process.nextTick( () => {
							handler( {
								process: { pm_id: mockProcessDescription.pmId },
								raw: { topic: 'result', siteId: mockSiteData.id, result: {} },
							} );
						} );
					} );
				}
			} );

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

			expect( pm2Manager.stopProcess ).toHaveBeenCalledWith( 'studio-site-test-site-id' );
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
