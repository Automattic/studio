import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { getSharedBrowser } from '@studio/agent/node/browser-utils';
import { findActiveSiteHeadlessDetails } from '@studio/agent/node/headless';
import { auditPerformance } from '@studio/agent/node/performance-audit';
import { auditSeo } from '@studio/agent/node/seo-audit';
import { resolveStudioTools, studioToolDefinitions } from '@studio/agent/node/tools';
import { bindTool, type AnyStudioAgentTool } from '@studio/agent/node/tools/define-tool';
import { createFakeHost, fakeHeadlessSite, fakeSite } from './fake-host';
import type { StudioAgentHost } from '@studio/agent/node/host';

vi.mock( '@studio/agent/node/browser-utils', () => ( { getSharedBrowser: vi.fn() } ) );
vi.mock( '@studio/agent/node/performance-audit', () => ( { auditPerformance: vi.fn() } ) );
vi.mock( '@studio/agent/node/seo-audit', () => ( { auditSeo: vi.fn() } ) );

describe( 'headless site tools', () => {
	let host: StudioAgentHost;

	const getTool = ( name: string ) => {
		const tool = studioToolDefinitions.find( ( definition ) => definition.name === name );
		expect( tool ).toBeDefined();
		return bindTool( tool!, host );
	};
	const call = async ( name: string, args: Record< string, unknown > ) =>
		( await getTool( name ).rawHandler( args as never ) ).content[ 0 ];
	const textOf = async ( name: string, args: Record< string, unknown > ) => {
		const content = await call( name, args );
		return content.type === 'text' ? content.text : '';
	};
	const useHeadlessSite = () =>
		vi.mocked( host.sites.resolve ).mockResolvedValue( fakeHeadlessSite );

	beforeEach( () => {
		vi.resetAllMocks();
		host = createFakeHost( os.tmpdir() );
	} );

	it( 'offers the frontend tools with and without a Studio UI', () => {
		const names = () => resolveStudioTools( host ).map( ( tool ) => tool.name );
		expect( names() ).toEqual( expect.arrayContaining( [ 'frontend_restart', 'frontend_logs' ] ) );
		host.ui = { showArtifact: vi.fn(), reloadPreview: vi.fn() };
		expect( names() ).toEqual( expect.arrayContaining( [ 'frontend_restart', 'frontend_logs' ] ) );
	} );

	describe( 'site_create', () => {
		it( 'creates a headless site and reports its frontend', async () => {
			useHeadlessSite();
			const ui = { showArtifact: vi.fn(), reloadPreview: vi.fn() };
			host.ui = ui;
			const tool = resolveStudioTools( host ).find(
				( candidate ) => candidate.name === 'site_create'
			) as AnyStudioAgentTool;

			const result = await tool.execute( 'call-1', {
				name: 'My Site',
				frontend: { framework: 'astro' },
			} as never );

			expect( host.sites.create ).toHaveBeenCalledWith(
				'My Site',
				path.join( os.tmpdir(), 'my-site' ),
				expect.any( Function ),
				{ frontend: { framework: 'astro' } }
			);
			const text = result.content[ 0 ].type === 'text' ? result.content[ 0 ].text : '';
			const parsed = JSON.parse( text );
			expect( parsed ).toMatchObject( {
				headless: true,
				frontendUrl: 'http://localhost:3000',
				frontendPath: '/sites/my-site/frontend',
				framework: 'astro',
				restBase: 'http://localhost:8888/wp-json/wp/v2',
			} );
			expect( text ).not.toContain( 'preview-secret' );
			expect( ui.showArtifact ).toHaveBeenCalledWith(
				expect.objectContaining( {
					widgets: [
						{
							type: 'site-preview',
							widgetProps: expect.objectContaining( {
								target: 'frontend',
								url: 'http://localhost:3000',
								wordpressUrl: 'http://localhost:8888',
							} ),
						},
					],
				} )
			);
		} );

		it( 'creates a classic site without frontend options', async () => {
			const text = await textOf( 'site_create', { name: 'My Site' } );

			expect( vi.mocked( host.sites.create ).mock.calls[ 0 ] ).toHaveLength( 3 );
			expect( JSON.parse( text ) ).not.toHaveProperty( 'headless' );
		} );
	} );

	describe( 'site_info', () => {
		it( 'reports the frontend and API endpoints of a headless site, without its secrets', async () => {
			vi.mocked( host.sites.resolve ).mockResolvedValue( {
				...fakeHeadlessSite,
				frontend: { ...fakeHeadlessSite.frontend!, api: 'graphql' },
			} );

			const text = await textOf( 'site_info', { nameOrPath: 'My Site' } );

			expect( JSON.parse( text ) ).toMatchObject( {
				headless: true,
				frontend: {
					frontendUrl: 'http://localhost:3000',
					frontendPath: '/sites/my-site/frontend',
					framework: 'astro',
					api: 'graphql',
					wordpressUrl: 'http://localhost:8888',
					restBase: 'http://localhost:8888/wp-json/wp/v2',
					graphqlUrl: 'http://localhost:8888/graphql',
				},
			} );
			expect( text ).not.toContain( 'secret' );
		} );

		it( 'says a classic site is not headless', async () => {
			const parsed = JSON.parse( await textOf( 'site_info', { nameOrPath: 'My Site' } ) );

			expect( parsed.headless ).toBe( false );
			expect( parsed ).not.toHaveProperty( 'frontend' );
		} );
	} );

	describe( 'frontend_restart', () => {
		it( 'restarts the frontend of a running headless site', async () => {
			useHeadlessSite();

			await expect( textOf( 'frontend_restart', { nameOrPath: 'My Site' } ) ).resolves.toContain(
				'http://localhost:3000'
			);
			expect( host.sites.frontendRestart ).toHaveBeenCalledWith(
				fakeHeadlessSite,
				expect.any( Function )
			);
		} );

		it( 'asks for the site to be started first', async () => {
			useHeadlessSite();
			vi.mocked( host.sites.isRunning ).mockResolvedValue( false );

			await expect( call( 'frontend_restart', { nameOrPath: 'My Site' } ) ).rejects.toThrow(
				'site_start'
			);
			expect( host.sites.frontendRestart ).not.toHaveBeenCalled();
		} );

		it( 'refuses a site that is not headless', async () => {
			vi.mocked( host.sites.resolve ).mockResolvedValue( fakeSite );

			await expect( call( 'frontend_restart', { nameOrPath: 'My Site' } ) ).rejects.toThrow(
				'is not a headless site'
			);
		} );
	} );

	describe( 'frontend_logs', () => {
		it( 'reads the latest frontend output, 100 lines by default', async () => {
			useHeadlessSite();
			vi.mocked( host.sites.frontendLogs ).mockResolvedValue( 'stderr:\nfetch failed\n' );

			await expect( textOf( 'frontend_logs', { nameOrPath: 'My Site' } ) ).resolves.toBe(
				'stderr:\nfetch failed'
			);
			expect( host.sites.frontendLogs ).toHaveBeenCalledWith( fakeHeadlessSite, 100 );

			await textOf( 'frontend_logs', { nameOrPath: 'My Site', lines: 5000 } );
			expect( host.sites.frontendLogs ).toHaveBeenLastCalledWith( fakeHeadlessSite, 1000 );
		} );

		it( 'says when the frontend has written nothing', async () => {
			useHeadlessSite();
			vi.mocked( host.sites.frontendLogs ).mockResolvedValue( '' );

			await expect( textOf( 'frontend_logs', { nameOrPath: 'My Site' } ) ).resolves.toContain(
				'has not written any output'
			);
		} );

		it( 'refuses a site that is not headless', async () => {
			vi.mocked( host.sites.resolve ).mockResolvedValue( fakeSite );

			await expect( call( 'frontend_logs', { nameOrPath: 'My Site' } ) ).rejects.toThrow(
				'is not a headless site'
			);
			expect( host.sites.frontendLogs ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'tools that render the site', () => {
		const mockPage = () => {
			const page = {
				emulateMedia: vi.fn(),
				goto: vi.fn(),
				waitForLoadState: vi.fn().mockResolvedValue( undefined ),
				evaluate: vi.fn().mockResolvedValueOnce( undefined ).mockResolvedValueOnce( [] ),
				close: vi.fn(),
			};
			vi.mocked( getSharedBrowser ).mockResolvedValue( {
				newPage: vi.fn().mockResolvedValue( page ),
			} as never );
			return page;
		};

		it( 'audit performance and SEO on the frontend of a headless site', async () => {
			useHeadlessSite();
			vi.mocked( auditPerformance ).mockResolvedValue( {} as never );
			vi.mocked( auditSeo ).mockResolvedValue( {} as never );

			await call( 'need_for_speed', { nameOrPath: 'My Site', path: '/blog' } );
			await call( 'rank_me_up', { nameOrPath: 'My Site' } );

			expect( auditPerformance ).toHaveBeenCalledWith( 'http://localhost:3000', '/blog' );
			expect( auditSeo ).toHaveBeenCalledWith( 'http://localhost:3000', '/' );
		} );

		it( 'audit WordPress itself on a classic site', async () => {
			vi.mocked( auditPerformance ).mockResolvedValue( {} as never );

			await call( 'need_for_speed', { nameOrPath: 'My Site' } );

			expect( auditPerformance ).toHaveBeenCalledWith( 'http://localhost:8888', '/' );
		} );

		it( 'inspect_design loads a page of the frontend given the site', async () => {
			useHeadlessSite();
			const page = mockPage();

			const text = await textOf( 'inspect_design', {
				nameOrPath: 'My Site',
				url: '/about',
				selectors: [ 'h1' ],
			} );

			expect( page.goto ).toHaveBeenCalledWith( 'http://localhost:3000/about', expect.anything() );
			expect( JSON.parse( text ).url ).toBe( 'http://localhost:3000/about' );
		} );

		it( 'inspect_design keeps a full URL and needs one without a site', async () => {
			const page = mockPage();

			await call( 'inspect_design', { url: 'http://localhost:8888/', selectors: [ 'h1' ] } );
			expect( page.goto ).toHaveBeenCalledWith( 'http://localhost:8888/', expect.anything() );
			expect( host.sites.resolve ).not.toHaveBeenCalled();

			await expect( call( 'inspect_design', { selectors: [ 'h1' ] } ) ).rejects.toThrow(
				'nameOrPath'
			);
		} );
	} );

	describe( 'findActiveSiteHeadlessDetails', () => {
		const activeSite = { name: 'My Site', path: '/sites/my-site/wordpress', running: true };

		it( "reads the active site's frontend from Studio's site data", async () => {
			vi.mocked( host.sites.findByFolder ).mockResolvedValue( fakeHeadlessSite );

			await expect( findActiveSiteHeadlessDetails( host, activeSite ) ).resolves.toMatchObject( {
				frontendUrl: 'http://localhost:3000',
				api: 'rest',
			} );
			expect( host.sites.findByFolder ).toHaveBeenCalledWith( '/sites/my-site/wordpress' );
		} );

		it( 'finds nothing for classic, remote, or unreadable sites', async () => {
			vi.mocked( host.sites.findByFolder ).mockResolvedValue( fakeSite );
			await expect( findActiveSiteHeadlessDetails( host, activeSite ) ).resolves.toBeUndefined();

			await expect(
				findActiveSiteHeadlessDetails( host, { ...activeSite, remote: true } )
			).resolves.toBeUndefined();

			vi.mocked( host.sites.findByFolder ).mockRejectedValue( new Error( 'locked' ) );
			await expect( findActiveSiteHeadlessDetails( host, activeSite ) ).resolves.toBeUndefined();
		} );
	} );
} );
