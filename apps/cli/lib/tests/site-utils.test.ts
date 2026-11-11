import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { vi, type Mock } from 'vitest';
import { openBrowser } from 'cli/lib/browser';
import { SiteData, readCliConfig } from 'cli/lib/cli-config/core';
import { isProxyProcessRunning, startProxyProcess, stopProxyProcess } from 'cli/lib/daemon-client';
import {
	openSiteInBrowser,
	restartProxyIfOutOfDate,
	setupCustomDomain,
	stopProxyIfNoSitesNeedIt,
} from 'cli/lib/site-utils';
import { isServerRunning, subscribeForReadyOrExit } from 'cli/lib/wordpress-server-manager';
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

describe( 'stopProxyIfNoSitesNeedIt', () => {
	const mockProcessDescription = {
		name: 'studio-proxy',
		pmId: 0,
		status: 'online',
		pid: 12345,
	};

	let mockLogger: Logger< LoggerAction >;

	const createSiteData = ( overrides: Partial< SiteData > = {} ): SiteData => ( {
		id: 'site-1',
		name: 'Test Site',
		path: '/test/site',
		port: 8881,
		phpVersion: '8.0',
		...overrides,
	} );

	beforeEach( () => {
		vi.clearAllMocks();

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
} );

describe( 'setupCustomDomain', () => {
	const logger = {
		reportStart: vi.fn(),
		reportSuccess: vi.fn(),
	} as unknown as Logger< LoggerAction >;
	const mockFetch = vi.fn();

	// Starts a site while the proxy is already running, with or without port 443. The proxy doesn't
	// answer when `proxyServesHttps` is undefined.
	async function startSiteWithProxyRunning(
		site: Partial< SiteData >,
		proxyServesHttps: boolean | undefined
	) {
		const siteData: SiteData = {
			id: 'site-1',
			name: 'Site',
			path: '/sites/site',
			port: 8881,
			phpVersion: '8.4',
			customDomain: 'site.local',
			...site,
		};
		( readCliConfig as Mock ).mockResolvedValue( { version: 1, sites: [ siteData ] } );
		if ( proxyServesHttps === undefined ) {
			mockFetch.mockRejectedValue( new Error( 'fetch failed' ) );
		} else {
			mockFetch.mockImplementation( async () => Response.json( { https: proxyServesHttps } ) );
		}
		await setupCustomDomain( siteData, logger, { skipHostsUpdate: true } );
	}

	beforeEach( () => {
		vi.clearAllMocks();
		vi.stubGlobal( 'fetch', mockFetch );
		( isProxyProcessRunning as Mock ).mockResolvedValue( { name: 'studio-proxy', pmId: 0 } );
		( startProxyProcess as Mock ).mockResolvedValue( { name: 'studio-proxy', pmId: 1 } );
		( subscribeForReadyOrExit as Mock ).mockResolvedValue( {
			waitFor: vi.fn(),
			dispose: vi.fn(),
		} );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'should restart a proxy without port 443 when a site uses HTTPS', async () => {
		await startSiteWithProxyRunning( { enableHttps: true }, false );

		expect( stopProxyProcess ).toHaveBeenCalled();
		expect( startProxyProcess ).toHaveBeenCalled();
	} );

	it( 'should restart a proxy holding port 443 when no site uses HTTPS', async () => {
		await startSiteWithProxyRunning( { enableHttps: false }, true );

		expect( stopProxyProcess ).toHaveBeenCalled();
		expect( startProxyProcess ).toHaveBeenCalled();
	} );

	it.each( [ true, false ] )(
		'should keep the proxy running when its ports match the sites (HTTPS: %s)',
		async ( enableHttps ) => {
			await startSiteWithProxyRunning( { enableHttps }, enableHttps );

			expect( stopProxyProcess ).not.toHaveBeenCalled();
			expect( startProxyProcess ).not.toHaveBeenCalled();
		}
	);

	it( 'should keep the proxy running when it does not answer', async () => {
		await startSiteWithProxyRunning( { enableHttps: true }, undefined );

		expect( stopProxyProcess ).not.toHaveBeenCalled();
	} );

	describe( 'restartProxyIfOutOfDate', () => {
		beforeEach( () => {
			( readCliConfig as Mock ).mockResolvedValue( { version: 1, sites: [] } );
			mockFetch.mockImplementation( async () => Response.json( { https: true } ) );
		} );

		it( 'should restart a proxy holding port 443 once no site uses HTTPS', async () => {
			( stopProxyProcess as Mock ).mockImplementation( async () => {
				( isProxyProcessRunning as Mock ).mockResolvedValue( undefined );
			} );

			await restartProxyIfOutOfDate( logger );

			expect( stopProxyProcess ).toHaveBeenCalled();
			expect( startProxyProcess ).toHaveBeenCalled();
		} );

		it( 'should not start a proxy that is not running', async () => {
			( isProxyProcessRunning as Mock ).mockResolvedValue( undefined );

			await restartProxyIfOutOfDate( logger );

			expect( startProxyProcess ).not.toHaveBeenCalled();
		} );
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
