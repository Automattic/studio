import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { vi, type Mock } from 'vitest';
import { openBrowser } from 'cli/lib/browser';
import { SiteData, readCliConfig } from 'cli/lib/cli-config/core';
import { isProxyProcessRunning, stopProxyProcess } from 'cli/lib/daemon-client';
import { openSiteInBrowser, setupCustomDomain, stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';

vi.mock( 'cli/lib/cli-config/core', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/core' );
	return {
		...actual,
		readCliConfig: vi.fn(),
	};
} );
vi.mock( 'cli/lib/browser' );
vi.mock( 'cli/lib/certificate-manager' );
vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'cli/lib/wordpress-server-manager' );

const mockProcessDescription = {
	name: 'studio-proxy',
	pmId: 0,
	status: 'online',
	pid: 12345,
};

const createSiteData = ( overrides: Partial< SiteData > = {} ): SiteData => ( {
	id: 'site-1',
	name: 'Test Site',
	path: '/test/site',
	port: 8881,
	phpVersion: '8.0',
	...overrides,
} );

const mockFetch = vi.fn();

function mockRunningSites( ...siteIds: string[] ) {
	( isServerRunning as Mock ).mockImplementation( async ( siteId: string ) =>
		siteIds.includes( siteId ) ? mockProcessDescription : undefined
	);
}

describe( 'stopProxyIfNoSitesNeedIt', () => {
	let mockLogger: Logger< LoggerAction >;

	beforeEach( () => {
		vi.clearAllMocks();
		mockFetch.mockResolvedValue( new Response( '{}' ) );
		vi.stubGlobal( 'fetch', mockFetch );

		mockLogger = {
			reportStart: vi.fn(),
			reportSuccess: vi.fn(),
			reportError: vi.fn(),
		} as unknown as Logger< LoggerAction >;

		( isProxyProcessRunning as Mock ).mockResolvedValue( undefined );
		( stopProxyProcess as Mock ).mockResolvedValue( undefined );
		( isServerRunning as Mock ).mockResolvedValue( undefined );
		( readCliConfig as Mock ).mockResolvedValue( { version: 1, sites: [] } );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	} );

	it( 'should do nothing if proxy is not running', async () => {
		( isProxyProcessRunning as Mock ).mockResolvedValue( undefined );

		await stopProxyIfNoSitesNeedIt( 'site-1', mockLogger );

		expect( readCliConfig ).not.toHaveBeenCalled();
		expect( stopProxyProcess ).not.toHaveBeenCalled();
	} );

	it( 'should stop proxy if no other sites exist', async () => {
		( isProxyProcessRunning as Mock ).mockResolvedValue( mockProcessDescription );
		( readCliConfig as Mock ).mockResolvedValue( {
			sites: [ createSiteData( { id: 'stopped-site' } ) ],
			version: 1,
		} );

		await stopProxyIfNoSitesNeedIt( 'stopped-site', mockLogger );

		expect( mockLogger.reportStart ).toHaveBeenCalledWith(
			'stopProxy',
			'Stopping HTTP proxy server…'
		);
		expect( stopProxyProcess ).toHaveBeenCalled();
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'HTTP proxy server stopped' );
	} );

	it( 'should stop proxy if other sites exist but none have custom domains', async () => {
		( isProxyProcessRunning as Mock ).mockResolvedValue( mockProcessDescription );
		( readCliConfig as Mock ).mockResolvedValue( {
			sites: [
				createSiteData( { id: 'stopped-site', customDomain: 'stopped.local' } ),
				createSiteData( { id: 'other-site-1' } ),
				createSiteData( { id: 'other-site-2' } ),
			],
			version: 1,
		} );

		await stopProxyIfNoSitesNeedIt( 'stopped-site', mockLogger );

		expect( stopProxyProcess ).toHaveBeenCalled();
	} );

	it( 'should stop proxy if other sites have custom domains but are not running', async () => {
		( isProxyProcessRunning as Mock ).mockResolvedValue( mockProcessDescription );
		( readCliConfig as Mock ).mockResolvedValue( {
			sites: [
				createSiteData( { id: 'stopped-site', customDomain: 'stopped.local' } ),
				createSiteData( { id: 'other-site', customDomain: 'other.local' } ),
			],
			version: 1,
		} );
		( isServerRunning as Mock ).mockResolvedValue( undefined );

		await stopProxyIfNoSitesNeedIt( 'stopped-site', mockLogger );

		expect( isServerRunning ).toHaveBeenCalledWith( 'other-site' );
		expect( stopProxyProcess ).toHaveBeenCalled();
	} );

	it( 'should not stop proxy if another site with custom domain is running', async () => {
		( isProxyProcessRunning as Mock ).mockResolvedValue( mockProcessDescription );
		( readCliConfig as Mock ).mockResolvedValue( {
			sites: [
				createSiteData( { id: 'stopped-site', customDomain: 'stopped.local' } ),
				createSiteData( { id: 'running-site', customDomain: 'running.local' } ),
			],
			version: 1,
		} );
		( isServerRunning as Mock ).mockResolvedValue( mockProcessDescription );

		await stopProxyIfNoSitesNeedIt( 'stopped-site', mockLogger );

		expect( isServerRunning ).toHaveBeenCalledWith( 'running-site' );
		expect( stopProxyProcess ).not.toHaveBeenCalled();
	} );

	it( 'should not check if the stopped site is running', async () => {
		( isProxyProcessRunning as Mock ).mockResolvedValue( mockProcessDescription );
		( readCliConfig as Mock ).mockResolvedValue( {
			sites: [ createSiteData( { id: 'stopped-site', customDomain: 'stopped.local' } ) ],
			version: 1,
		} );

		await stopProxyIfNoSitesNeedIt( 'stopped-site', mockLogger );

		expect( isServerRunning ).not.toHaveBeenCalledWith( 'stopped-site' );
		expect( stopProxyProcess ).toHaveBeenCalled();
	} );

	it( 'should release port 443 when no running site uses HTTPS anymore', async () => {
		( isProxyProcessRunning as Mock ).mockResolvedValue( mockProcessDescription );
		( readCliConfig as Mock ).mockResolvedValue( {
			sites: [
				createSiteData( { id: 'stopped-site', customDomain: 'stopped.local', enableHttps: true } ),
				createSiteData( { id: 'http-site', customDomain: 'http.local' } ),
				createSiteData( { id: 'idle-site', customDomain: 'idle.local', enableHttps: true } ),
			],
			version: 1,
		} );
		mockRunningSites( 'http-site' );

		await stopProxyIfNoSitesNeedIt( 'stopped-site', mockLogger );

		expect( stopProxyProcess ).not.toHaveBeenCalled();
		expect( mockFetch ).toHaveBeenCalledWith(
			'http://127.0.0.1/__studio_https/disable',
			expect.objectContaining( { method: 'POST' } )
		);
	} );

	it( 'should keep port 443 while another running site uses HTTPS', async () => {
		( isProxyProcessRunning as Mock ).mockResolvedValue( mockProcessDescription );
		( readCliConfig as Mock ).mockResolvedValue( {
			sites: [
				createSiteData( { id: 'stopped-site', customDomain: 'stopped.local', enableHttps: true } ),
				createSiteData( { id: 'https-site', customDomain: 'https.local', enableHttps: true } ),
			],
			version: 1,
		} );
		mockRunningSites( 'https-site' );

		await stopProxyIfNoSitesNeedIt( 'stopped-site', mockLogger );

		expect( mockFetch ).not.toHaveBeenCalled();
	} );
} );

describe( 'setupCustomDomain', () => {
	const mockLogger = {
		reportStart: vi.fn(),
		reportSuccess: vi.fn(),
		reportError: vi.fn(),
	} as unknown as Logger< LoggerAction >;
	const options = { skipHostsUpdate: true };

	beforeEach( () => {
		vi.clearAllMocks();
		mockFetch.mockResolvedValue( new Response( '{}' ) );
		vi.stubGlobal( 'fetch', mockFetch );
		( isProxyProcessRunning as Mock ).mockResolvedValue( mockProcessDescription );
		( isServerRunning as Mock ).mockResolvedValue( undefined );
		( readCliConfig as Mock ).mockResolvedValue( { version: 1, sites: [] } );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'should leave port 443 free for a site without HTTPS', async () => {
		const site = createSiteData( { customDomain: 'site.local', enableHttps: false } );
		( readCliConfig as Mock ).mockResolvedValue( { version: 1, sites: [ site ] } );

		await setupCustomDomain( site, mockLogger, options );

		expect( mockFetch ).toHaveBeenCalledTimes( 1 );
		expect( mockFetch ).toHaveBeenCalledWith(
			'http://127.0.0.1/__studio_https/disable',
			expect.objectContaining( { method: 'POST' } )
		);
	} );

	it( 'should bind port 443 for a site with HTTPS', async () => {
		const site = createSiteData( { customDomain: 'site.local', enableHttps: true } );

		await setupCustomDomain( site, mockLogger, options );

		expect( mockFetch ).toHaveBeenCalledWith(
			'http://127.0.0.1/__studio_https/enable',
			expect.objectContaining( { method: 'POST' } )
		);
	} );

	it( 'should keep port 443 for a site without HTTPS while another running site uses it', async () => {
		const site = createSiteData( { customDomain: 'site.local' } );
		const httpsSite = createSiteData( {
			id: 'https-site',
			customDomain: 'https.local',
			enableHttps: true,
		} );
		( readCliConfig as Mock ).mockResolvedValue( { version: 1, sites: [ site, httpsSite ] } );
		mockRunningSites( 'https-site' );

		await setupCustomDomain( site, mockLogger, options );

		expect( mockFetch ).toHaveBeenCalledWith(
			'http://127.0.0.1/__studio_https/enable',
			expect.anything()
		);
	} );

	it( 'should report the port conflict when port 443 is taken', async () => {
		mockFetch.mockResolvedValue(
			new Response( 'Error: listen EADDRINUSE: address already in use :::443', { status: 500 } )
		);
		const site = createSiteData( { customDomain: 'site.local', enableHttps: true } );

		await expect( setupCustomDomain( site, mockLogger, options ) ).rejects.toThrow( '443' );
	} );

	it( 'should not fail for a site without HTTPS when the proxy cannot be reached', async () => {
		mockFetch.mockRejectedValue( new Error( 'fetch failed' ) );
		const site = createSiteData( { customDomain: 'site.local' } );

		await expect( setupCustomDomain( site, mockLogger, options ) ).resolves.toBeUndefined();
	} );

	it( 'should accept a proxy from an older Studio version, which always binds port 443', async () => {
		mockFetch.mockResolvedValue( new Response( 'Domain not found', { status: 404 } ) );
		const site = createSiteData( { customDomain: 'site.local', enableHttps: true } );

		await expect( setupCustomDomain( site, mockLogger, options ) ).resolves.toBeUndefined();
	} );
} );

describe( 'openSiteInBrowser', () => {
	const site: SiteData = {
		id: 'site-1',
		name: 'Site',
		path: '/sites/site',
		port: 8881,
		phpVersion: '8.4',
	};

	beforeEach( () => {
		vi.mocked( openBrowser ).mockReset();
	} );

	it( 'opens the front page when the site has no landing page', async () => {
		await openSiteInBrowser( site );

		expect( openBrowser ).toHaveBeenCalledWith( 'http://localhost:8881/' );
	} );

	it( 'opens the Blueprint landing page through auto-login', async () => {
		await openSiteInBrowser( { ...site, landingPage: '/wp-admin/edit.php' } );

		expect( openBrowser ).toHaveBeenCalledWith(
			'http://localhost:8881/studio-auto-login?redirect_to=' +
				encodeURIComponent( 'http://localhost:8881/wp-admin/edit.php' )
		);
	} );
} );
