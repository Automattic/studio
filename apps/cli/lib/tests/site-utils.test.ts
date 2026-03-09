import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { vi, type Mock } from 'vitest';
import { SiteData, readCliConfig } from 'cli/lib/cli-config';
import { isProxyProcessRunning, stopProxyProcess } from 'cli/lib/pm2-manager';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';
vi.mock( 'pm2' );

vi.mock( 'cli/lib/cli-config', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config' );
	return {
		...actual,
		readCliConfig: vi.fn(),
	};
} );
vi.mock( 'cli/lib/pm2-manager' );
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
} );
