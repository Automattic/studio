import { SiteData, readAppdata } from 'cli/lib/appdata';
import { isProxyProcessRunning, stopProxyProcess } from 'cli/lib/pm2-manager';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { vi, type Mock } from 'vitest';

vi.mock( 'pm2' );

vi.mock( 'cli/lib/appdata', async () => {
	const actual = await vi.importActual( 'cli/lib/appdata' );
	return {
		...actual,
		getAppdataDirectory: vi.fn().mockReturnValue( '/test/appdata' ),
		readAppdata: vi.fn(),
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
		( readAppdata as Mock ).mockResolvedValue( { sites: [], snapshots: [] } );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should do nothing if proxy is not running', async () => {
		( isProxyProcessRunning as Mock ).mockResolvedValue( undefined );

		await stopProxyIfNoSitesNeedIt( 'site-1', mockLogger );

		expect( readAppdata ).not.toHaveBeenCalled();
		expect( stopProxyProcess ).not.toHaveBeenCalled();
	} );

	it( 'should stop proxy if no other sites exist', async () => {
		( isProxyProcessRunning as Mock ).mockResolvedValue( mockProcessDescription );
		( readAppdata as Mock ).mockResolvedValue( {
			sites: [ createSiteData( { id: 'stopped-site' } ) ],
			snapshots: [],
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
		( readAppdata as Mock ).mockResolvedValue( {
			sites: [
				createSiteData( { id: 'stopped-site', customDomain: 'stopped.local' } ),
				createSiteData( { id: 'other-site-1' } ),
				createSiteData( { id: 'other-site-2' } ),
			],
			snapshots: [],
		} );

		await stopProxyIfNoSitesNeedIt( 'stopped-site', mockLogger );

		expect( stopProxyProcess ).toHaveBeenCalled();
	} );

	it( 'should stop proxy if other sites have custom domains but are not running', async () => {
		( isProxyProcessRunning as Mock ).mockResolvedValue( mockProcessDescription );
		( readAppdata as Mock ).mockResolvedValue( {
			sites: [
				createSiteData( { id: 'stopped-site', customDomain: 'stopped.local' } ),
				createSiteData( { id: 'other-site', customDomain: 'other.local' } ),
			],
			snapshots: [],
		} );
		( isServerRunning as Mock ).mockResolvedValue( undefined );

		await stopProxyIfNoSitesNeedIt( 'stopped-site', mockLogger );

		expect( isServerRunning ).toHaveBeenCalledWith( 'other-site' );
		expect( stopProxyProcess ).toHaveBeenCalled();
	} );

	it( 'should not stop proxy if another site with custom domain is running', async () => {
		( isProxyProcessRunning as Mock ).mockResolvedValue( mockProcessDescription );
		( readAppdata as Mock ).mockResolvedValue( {
			sites: [
				createSiteData( { id: 'stopped-site', customDomain: 'stopped.local' } ),
				createSiteData( { id: 'running-site', customDomain: 'running.local' } ),
			],
			snapshots: [],
		} );
		( isServerRunning as Mock ).mockResolvedValue( mockProcessDescription );

		await stopProxyIfNoSitesNeedIt( 'stopped-site', mockLogger );

		expect( isServerRunning ).toHaveBeenCalledWith( 'running-site' );
		expect( stopProxyProcess ).not.toHaveBeenCalled();
	} );

	it( 'should not check if the stopped site is running', async () => {
		( isProxyProcessRunning as Mock ).mockResolvedValue( mockProcessDescription );
		( readAppdata as Mock ).mockResolvedValue( {
			sites: [ createSiteData( { id: 'stopped-site', customDomain: 'stopped.local' } ) ],
			snapshots: [],
		} );

		await stopProxyIfNoSitesNeedIt( 'stopped-site', mockLogger );

		expect( isServerRunning ).not.toHaveBeenCalledWith( 'stopped-site' );
		expect( stopProxyProcess ).toHaveBeenCalled();
	} );
} );
