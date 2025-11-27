import { arePathsEqual } from 'common/lib/fs-utils';
import { readAppdata, updateSiteLatestCliPid, SiteData } from 'cli/lib/appdata';
import { openBrowser } from 'cli/lib/browser';
import { generateSiteCertificate } from 'cli/lib/certificate-manager';
import { addDomainToHosts } from 'cli/lib/hosts-file';
import { connect, disconnect, isProxyProcessRunning, startProxyProcess } from 'cli/lib/pm2-manager';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { isServerRunning, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getAppdataDirectory: jest.fn().mockReturnValue( '/test/appdata' ),
	readAppdata: jest.fn(),
	updateSiteLatestCliPid: jest.fn(),
	getSiteUrl: jest.fn( ( site ) => `http://localhost:${ site.port }` ),
} ) );
jest.mock( 'cli/lib/browser' );
jest.mock( 'cli/lib/certificate-manager' );
jest.mock( 'cli/lib/hosts-file' );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/wordpress-server-manager' );
jest.mock( 'cli/logger' );
jest.mock( 'cli/lib/sqlite-integration' );
jest.mock( 'common/lib/fs-utils' );

describe( 'Site Start Command', () => {
	const mockSiteFolder = '/test/site/path';
	const mockSiteData: SiteData = {
		id: 'test-site-id',
		name: 'Test Site',
		path: mockSiteFolder,
		port: 8881,
		adminUsername: 'admin',
		adminPassword: 'password123',
		running: false,
		phpVersion: '8.0',
		url: `http://localhost:8881`,
	};

	const mockSiteDataWithCustomDomain: SiteData = {
		...mockSiteData,
		customDomain: 'testsite.local',
	};

	const mockSiteDataWithHttps: SiteData = {
		...mockSiteDataWithCustomDomain,
		enableHttps: true,
	};

	const mockSiteDataWithExistingCerts: SiteData = {
		...mockSiteDataWithHttps,
		tlsKey: '/path/to/key.pem',
		tlsCert: '/path/to/cert.pem',
	};

	const mockProcessDescription = {
		name: 'test-site-id',
		pmId: 0,
		status: 'online',
		pid: 12345,
	};

	const mockProxyProcess = {
		name: 'studio-proxy',
		pmId: 1,
		status: 'online',
		pid: 54321,
	};

	let mockLogger: {
		reportStart: jest.Mock;
		reportSuccess: jest.Mock;
		reportError: jest.Mock;
	};

	let consoleLogSpy: jest.SpyInstance;

	beforeEach( () => {
		jest.clearAllMocks();

		mockLogger = {
			reportStart: jest.fn(),
			reportSuccess: jest.fn(),
			reportError: jest.fn(),
		};

		( Logger as jest.Mock ).mockReturnValue( mockLogger );

		// Mock process.exit to prevent test termination
		jest.spyOn( process, 'exit' ).mockImplementation( () => {
			throw new Error( 'process.exit called' );
		} );

		// Mock console.log for logSiteDetails
		consoleLogSpy = jest.spyOn( console, 'log' ).mockImplementation();

		// Default mock implementations
		( connect as jest.Mock ).mockResolvedValue( undefined );
		( disconnect as jest.Mock ).mockReturnValue( undefined );
		( isServerRunning as jest.Mock ).mockResolvedValue( undefined );
		( isProxyProcessRunning as jest.Mock ).mockResolvedValue( undefined );
		( startProxyProcess as jest.Mock ).mockResolvedValue( mockProxyProcess );
		( startWordPressServer as jest.Mock ).mockResolvedValue( mockProcessDescription );
		( updateSiteLatestCliPid as jest.Mock ).mockResolvedValue( undefined );
		( openBrowser as jest.Mock ).mockResolvedValue( undefined );
		( generateSiteCertificate as jest.Mock ).mockResolvedValue( undefined );
		( addDomainToHosts as jest.Mock ).mockResolvedValue( undefined );
		( keepSqliteIntegrationUpdated as jest.Mock ).mockResolvedValue( undefined );
		( arePathsEqual as jest.Mock ).mockImplementation( ( path1, path2 ) => path1 === path2 );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Error Handling', () => {
		it( 'should handle site not found error', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [],
				snapshots: [],
			} );

			const { runCommand } = await import( '../start' );

			await expect( async () => {
				await runCommand( mockSiteFolder );
			} ).rejects.toThrow( 'process.exit called' );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle PM2 connection failure', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteData ],
				snapshots: [],
			} );
			( connect as jest.Mock ).mockRejectedValue( new Error( 'PM2 connection failed' ) );

			const { runCommand } = await import( '../start' );

			await expect( async () => {
				await runCommand( mockSiteFolder );
			} ).rejects.toThrow( 'process.exit called' );

			expect( mockLogger.reportStart ).toHaveBeenCalledWith(
				'startDaemon',
				'Starting process daemon...'
			);
			expect( mockLogger.reportError ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle WordPress server start failure', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteData ],
				snapshots: [],
			} );
			( startWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server start failed' ) );

			const { runCommand } = await import( '../start' );

			await expect( async () => {
				await runCommand( mockSiteFolder );
			} ).rejects.toThrow( 'process.exit called' );

			expect( mockLogger.reportStart ).toHaveBeenCalledWith(
				'startSite',
				'Starting WordPress site...'
			);
			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle hosts file update failure', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteDataWithCustomDomain ],
				snapshots: [],
			} );
			( addDomainToHosts as jest.Mock ).mockRejectedValue( new Error( 'Hosts file error' ) );

			const { runCommand } = await import( '../start' );

			await expect( async () => {
				await runCommand( mockSiteFolder );
			} ).rejects.toThrow( 'process.exit called' );

			expect( mockLogger.reportStart ).toHaveBeenCalledWith(
				'addDomainToHosts',
				'Adding domain to hosts file...'
			);
			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle certificate generation failure', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteDataWithHttps ],
				snapshots: [],
			} );
			( generateSiteCertificate as jest.Mock ).mockRejectedValue(
				new Error( 'Certificate generation failed' )
			);

			const { runCommand } = await import( '../start' );

			await expect( async () => {
				await runCommand( mockSiteFolder );
			} ).rejects.toThrow( 'process.exit called' );

			expect( mockLogger.reportStart ).toHaveBeenCalledWith(
				'generateCert',
				'Generating SSL certificates...'
			);
			expect( mockLogger.reportError ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should skip startup if server is already running', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteData ],
				snapshots: [],
			} );
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../start' );
			await runCommand( mockSiteFolder );

			expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
				'WordPress site is already running'
			);
			expect( updateSiteLatestCliPid ).toHaveBeenCalledWith(
				mockSiteData.id,
				mockProcessDescription.pid
			);
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( consoleLogSpy ).toHaveBeenCalledWith( 'Site URL: ', mockSiteData.url );
			expect( consoleLogSpy ).toHaveBeenCalledWith( 'Username: ', 'admin' );
			expect( consoleLogSpy ).toHaveBeenCalledWith( 'Password: ', mockSiteData.adminPassword );
			expect( openBrowser ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should start basic site without custom domain', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteData ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../start' );
			await runCommand( mockSiteFolder );

			expect( mockLogger.reportStart ).toHaveBeenCalledWith(
				'startDaemon',
				'Starting process daemon...'
			);
			expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'Process daemon started' );
			expect( connect ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( mockSiteData.id );
			expect( startProxyProcess ).not.toHaveBeenCalled();
			expect( generateSiteCertificate ).not.toHaveBeenCalled();
			expect( addDomainToHosts ).not.toHaveBeenCalled();
			expect( mockLogger.reportStart ).toHaveBeenCalledWith(
				'startSite',
				'Starting WordPress site...'
			);
			expect( startWordPressServer ).toHaveBeenCalledWith( mockSiteData );
			expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'WordPress site started' );
			expect( updateSiteLatestCliPid ).toHaveBeenCalledWith(
				mockSiteData.id,
				mockProcessDescription.pid
			);
			expect( consoleLogSpy ).toHaveBeenCalledWith( 'Site URL: ', mockSiteData.url );
			expect( openBrowser ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should start site with custom domain (HTTP)', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteDataWithCustomDomain ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../start' );
			await runCommand( mockSiteFolder );

			expect( mockLogger.reportStart ).toHaveBeenCalledWith(
				'startProxy',
				'Starting HTTP proxy server...'
			);
			expect( isProxyProcessRunning ).toHaveBeenCalled();
			expect( startProxyProcess ).toHaveBeenCalled();
			expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'HTTP proxy server started' );
			expect( generateSiteCertificate ).not.toHaveBeenCalled();
			expect( mockLogger.reportStart ).toHaveBeenCalledWith(
				'addDomainToHosts',
				'Adding domain to hosts file...'
			);
			expect( addDomainToHosts ).toHaveBeenCalledWith(
				mockSiteDataWithCustomDomain.customDomain,
				mockSiteDataWithCustomDomain.port
			);
			expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'Domain added to hosts file' );
			expect( startWordPressServer ).toHaveBeenCalledWith( mockSiteDataWithCustomDomain );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should start site with custom domain (HTTPS) and generate certificate', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteDataWithHttps ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../start' );
			await runCommand( mockSiteFolder );

			expect( mockLogger.reportStart ).toHaveBeenCalledWith(
				'generateCert',
				'Generating SSL certificates...'
			);
			expect( generateSiteCertificate ).toHaveBeenCalledWith( mockSiteDataWithHttps.customDomain );
			expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'SSL certificates generated' );
			expect( addDomainToHosts ).toHaveBeenCalled();
			expect( startWordPressServer ).toHaveBeenCalledWith( mockSiteDataWithHttps );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should not generate certificate if it already exists', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteDataWithExistingCerts ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../start' );
			await runCommand( mockSiteFolder );

			expect( generateSiteCertificate ).not.toHaveBeenCalled();
			expect( addDomainToHosts ).toHaveBeenCalled();
			expect( startWordPressServer ).toHaveBeenCalledWith( mockSiteDataWithExistingCerts );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should skip proxy start if proxy is already running', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteDataWithCustomDomain ],
				snapshots: [],
			} );
			( isProxyProcessRunning as jest.Mock ).mockResolvedValue( mockProxyProcess );

			const { runCommand } = await import( '../start' );
			await runCommand( mockSiteFolder );

			expect( isProxyProcessRunning ).toHaveBeenCalled();
			expect( startProxyProcess ).not.toHaveBeenCalled();
			expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'HTTP proxy already running' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should skip browser when skipBrowser flag is true', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteData ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../start' );
			await runCommand( mockSiteFolder, true );

			expect( startWordPressServer ).toHaveBeenCalledWith( mockSiteData );
			expect( openBrowser ).not.toHaveBeenCalled();
			expect( consoleLogSpy ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should skip browser when server is already running and skipBrowser is true', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteData ],
				snapshots: [],
			} );
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../start' );
			await runCommand( mockSiteFolder, true );

			expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
				'WordPress site is already running'
			);
			expect( openBrowser ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should not fail if browser fails to open', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteData ],
				snapshots: [],
			} );
			( openBrowser as jest.Mock ).mockRejectedValue( new Error( 'Browser error' ) );

			const { runCommand } = await import( '../start' );
			await runCommand( mockSiteFolder );

			expect( startWordPressServer ).toHaveBeenCalled();
			expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'WordPress site started' );
			expect( disconnect ).toHaveBeenCalled();
			// Should not call reportError for browser failure
			expect( mockLogger.reportError ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'Cleanup', () => {
		it( 'should disconnect from PM2 even on error', async () => {
			( readAppdata as jest.Mock ).mockRejectedValue( new Error( 'Appdata error' ) );

			const { runCommand } = await import( '../start' );

			await expect( async () => {
				await runCommand( mockSiteFolder );
			} ).rejects.toThrow( 'process.exit called' );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should disconnect from PM2 on success', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteData ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../start' );
			await runCommand( mockSiteFolder );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should disconnect from PM2 even if server was already running', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteData ],
				snapshots: [],
			} );
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../start' );
			await runCommand( mockSiteFolder );

			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );
