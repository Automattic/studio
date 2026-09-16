import { describe, expect, it, vi } from 'vitest';
import {
	PREVIEW_CONTENT_WIDTH_STORAGE_KEY,
	SIDEBAR_PANEL_STORAGE_KEY,
} from '@/lib/resizable-panels';
import {
	MARKETING_SCENARIO_IDS,
	applyMarketingPanelLayout,
	createMarketingConnector as createBaseMarketingConnector,
	getMarketingScenario,
	resolveMarketingPanelLayout,
} from './index';

const TEST_WORDPRESS_ORIGIN = 'http://localhost:43210';

function createMarketingConnector(
	scenario: Parameters< typeof createBaseMarketingConnector >[ 0 ],
	theme: Parameters< typeof createBaseMarketingConnector >[ 1 ],
	panelLayout?: Parameters< typeof createBaseMarketingConnector >[ 2 ],
	options: Parameters< typeof createBaseMarketingConnector >[ 3 ] = {}
) {
	return createBaseMarketingConnector( scenario, theme, panelLayout, {
		previewOrigin: TEST_WORDPRESS_ORIGIN,
		...options,
	} );
}

describe( 'marketing screenshot scenarios', () => {
	it( 'registers stable routes and readiness selectors', () => {
		expect( MARKETING_SCENARIO_IDS ).toEqual( [
			'add-site',
			'site-overview',
			'site-portfolio',
			'agent-new-session',
			'agent-working-preview',
			'agent-complete-preview',
			'agent-long-conversation',
			'connected-site-controls',
			'selective-sync',
			'responsive-preview',
		] );
		expect( getMarketingScenario( 'add-site' ) ).toMatchObject( {
			route: '/onboarding',
			readySelector: 'h1',
		} );
		expect( getMarketingScenario( 'site-overview' ) ).toMatchObject( {
			route: '/sites/meridian/overview',
		} );
		expect( getMarketingScenario( 'agent-complete-preview' ) ).toMatchObject( {
			route: '/sessions/marketing-agent-complete',
			panelLayout: {
				sidebar: { state: 'collapsed', width: 300 },
				preview: { state: 'open', widthRatio: 0.6 },
			},
		} );
		expect( getMarketingScenario( 'agent-new-session' ) ).toMatchObject( {
			route: '/sessions/marketing-agent-new',
			readySelector: '[data-session-composer]',
		} );
		expect( getMarketingScenario( 'agent-working-preview' ) ).toMatchObject( {
			route: '/sessions/marketing-agent-working',
			panelLayout: {
				preview: { state: 'open', widthRatio: 0.6 },
			},
		} );
		expect( getMarketingScenario( 'connected-site-controls' ) ).toMatchObject( {
			route: '/sites/meridian/overview?sync=pull',
			readySelector: 'button[aria-label="Pull from live"]',
		} );
		expect( getMarketingScenario( 'agent-long-conversation' ) ).toMatchObject( {
			route: '/sessions/marketing-agent-long',
			panelLayout: {
				sidebar: { state: 'collapsed' },
				preview: { state: 'closed' },
			},
		} );
		expect( getMarketingScenario( 'selective-sync' ) ).toMatchObject( {
			readySelector: 'button[aria-label="Pull from live"]',
		} );
		expect( getMarketingScenario( 'responsive-preview' ) ).toMatchObject( {
			readySelector: '[aria-label="Site preview"] iframe',
		} );
	} );

	it( 'rejects unknown scenario ids with the available choices', () => {
		expect( () => getMarketingScenario( 'missing' ) ).toThrow(
			'Expected one of: add-site, site-overview, site-portfolio, agent-new-session, agent-working-preview, agent-complete-preview, agent-long-conversation, connected-site-controls, selective-sync, responsive-preview'
		);
	} );

	it( 'resolves explicit panel overrides without changing scenario defaults', () => {
		const scenario = getMarketingScenario( 'agent-complete-preview' );
		const layout = resolveMarketingPanelLayout(
			scenario.panelLayout,
			new URLSearchParams( {
				sidebar: 'collapsed',
				sidebarWidth: '280',
				preview: 'closed',
				previewWidthRatio: '0.6',
			} )
		);

		expect( layout ).toEqual( {
			sidebar: { state: 'collapsed', width: 280 },
			preview: { state: 'closed', widthRatio: 0.6 },
		} );
		expect( scenario.panelLayout.preview.widthRatio ).toBe( 0.6 );
	} );

	it( 'rejects invalid panel overrides', () => {
		const defaults = getMarketingScenario( 'agent-complete-preview' ).panelLayout;

		expect( () =>
			resolveMarketingPanelLayout( defaults, new URLSearchParams( { preview: 'fullscreen' } ) )
		).toThrow( 'Expected one of: open, closed' );
		expect( () =>
			resolveMarketingPanelLayout( defaults, new URLSearchParams( { previewWidthRatio: '0.9' } ) )
		).toThrow( 'must be between 0.2 and 0.8' );
	} );

	it.each( [
		{
			viewportWidth: 900,
			storedSidebarWidth: 240,
			renderedSidebarWidth: 225,
			contentWidth: 280,
			previewWidth: 383,
		},
		{
			viewportWidth: 1100,
			storedSidebarWidth: 275,
			renderedSidebarWidth: 275,
			contentWidth: 325,
			previewWidth: 488,
		},
		{
			viewportWidth: 1440,
			storedSidebarWidth: 320,
			renderedSidebarWidth: 320,
			contentWidth: 443,
			previewWidth: 665,
		},
		{
			viewportWidth: 1920,
			storedSidebarWidth: 320,
			renderedSidebarWidth: 320,
			contentWidth: 635,
			previewWidth: 953,
		},
	] )(
		'seeds a responsive preview-first split at $viewportWidth px',
		( { viewportWidth, storedSidebarWidth, renderedSidebarWidth, contentWidth, previewWidth } ) => {
			window.localStorage.clear();
			const applied = applyMarketingPanelLayout(
				{
					...getMarketingScenario( 'agent-working-preview' ).panelLayout,
					sidebar: { state: 'expanded', width: 320 },
				},
				viewportWidth
			);

			expect( applied ).toEqual( {
				sidebar: { state: 'expanded', width: renderedSidebarWidth },
				preview: {
					state: 'open',
					requestedWidthRatio: 0.6,
					contentWidth,
					width: previewWidth,
				},
			} );
			expect( window.localStorage.getItem( SIDEBAR_PANEL_STORAGE_KEY ) ).toBe(
				String( storedSidebarWidth )
			);
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBe(
				String( contentWidth )
			);
		}
	);
} );

describe( 'marketing screenshot connector', () => {
	it( 'returns deterministic fixture data without using fetch', async () => {
		const fetchSpy = vi.spyOn( globalThis, 'fetch' );
		const connector = createMarketingConnector( getMarketingScenario( 'site-overview' ), 'dark' );

		await connector.init?.();
		const [ sites, preferences, thumbnail, storage ] = await Promise.all( [
			connector.getSites(),
			connector.getUserPreferences(),
			connector.getSiteThumbnail( 'meridian' ),
			connector.getSiteStorageUsage( 'meridian' ),
		] );

		expect( sites.map( ( site ) => site.name ) ).toEqual( [
			'Meridian Coffee',
			'Juniper Journal',
			'Atlas Creative',
			'Lantern Books',
			'Northstar Yoga',
			'Harbor & Pine',
			'Fieldwork Studio',
			'Common Table',
		] );
		expect( sites.map( ( site ) => decodeURIComponent( site.siteIcon ?? '' ) ) ).not.toEqual(
			expect.arrayContaining( [ expect.stringMatching( /<rect[^>]+\srx=/ ) ] )
		);
		expect( preferences.colorScheme ).toBe( 'dark' );
		expect( thumbnail ).toMatch( /^data:image\/svg\+xml/ );
		expect( storage?.total ).toBe( 191_889_408 );
		expect( fetchSpy ).not.toHaveBeenCalled();

		fetchSpy.mockRestore();
	} );

	it( 'provides the session state selected by each agent scenario', async () => {
		const overviewConnector = createMarketingConnector(
			getMarketingScenario( 'site-overview' ),
			'light'
		);
		const newAgentConnector = createMarketingConnector(
			getMarketingScenario( 'agent-new-session' ),
			'light'
		);
		const workingAgentConnector = createMarketingConnector(
			getMarketingScenario( 'agent-working-preview' ),
			'light'
		);
		const completeAgentConnector = createMarketingConnector(
			getMarketingScenario( 'agent-complete-preview' ),
			'light'
		);
		const longAgentConnector = createMarketingConnector(
			getMarketingScenario( 'agent-long-conversation' ),
			'light'
		);

		expect( await overviewConnector.getSessions() ).toEqual( [] );
		expect( await newAgentConnector.getSessions() ).toEqual( [
			expect.objectContaining( { id: 'marketing-agent-new', eventCount: 0 } ),
		] );
		expect( await newAgentConnector.getSession( 'marketing-agent-new' ) ).toMatchObject( {
			entries: [],
		} );
		expect( await workingAgentConnector.getSessions() ).toEqual( [
			expect.objectContaining( { id: 'marketing-agent-working', eventCount: 5 } ),
		] );
		expect( await workingAgentConnector.getActiveAgentRuns() ).toEqual( [
			expect.objectContaining( {
				runId: 'marketing-agent-working-run',
				sessionId: 'marketing-agent-working',
				phase: 'running',
			} ),
		] );
		const session = await completeAgentConnector.getSession( 'marketing-agent-complete' );
		expect( session.summary.ownerSiteName ).toBe( 'Meridian Coffee' );
		expect( session.entries ).toHaveLength( 7 );
		expect(
			await completeAgentConnector.continueSession( 'marketing-agent-complete', 'annotation data' )
		).toEqual( { runId: 'marketing-marketing-agent-complete-run' } );
		expect( await longAgentConnector.getSessions() ).toEqual( [
			expect.objectContaining( { id: 'marketing-agent-long', eventCount: 13 } ),
		] );
		const longSession = await longAgentConnector.getSession( 'marketing-agent-long' );
		expect( longSession.entries ).toHaveLength( 13 );
	} );

	it( 'provides connected Pressable and preview data only to the controls scenario', async () => {
		const overviewConnector = createMarketingConnector(
			getMarketingScenario( 'site-overview' ),
			'light'
		);
		const connectedConnector = createMarketingConnector(
			getMarketingScenario( 'connected-site-controls' ),
			'light'
		);
		const selectiveSyncConnector = createMarketingConnector(
			getMarketingScenario( 'selective-sync' ),
			'dark'
		);

		expect( await overviewConnector.getConnectedWpcomSites( 'meridian' ) ).toEqual( [] );
		expect( await overviewConnector.getSnapshots() ).toEqual( [] );
		expect( await overviewConnector.getAuthUser() ).toBeNull();
		expect( await connectedConnector.getConnectedWpcomSites( 'other-site' ) ).toEqual( [] );
		expect( await connectedConnector.getAuthUser() ).toEqual( {
			id: 2_026_811,
			email: '',
			displayName: 'Alex Morgan',
		} );
		expect( await connectedConnector.getConnectedWpcomSites( 'meridian' ) ).toEqual( [
			expect.objectContaining( {
				name: 'Meridian Coffee',
				isPressable: true,
				syncSupport: 'already-connected',
			} ),
		] );
		expect( await connectedConnector.getSnapshots() ).toEqual( [
			expect.objectContaining( {
				localSiteId: 'meridian',
				url: 'meridian-coffee.wpcomstaging.com',
			} ),
		] );
		expect( await connectedConnector.getSnapshotUsage() ).toEqual( {
			siteCount: 1,
			siteLimit: 5,
			siteCreationBlocked: false,
		} );
		expect( await selectiveSyncConnector.getLatestRewindId( 8_472_091 ) ).toBe( '1786449600' );
		expect(
			await selectiveSyncConnector.listRemoteFileTree( 8_472_091, '1786449600', '/wp-content/' )
		).toEqual(
			expect.objectContaining( {
				plugins: expect.objectContaining( { type: 'dir' } ),
				themes: expect.objectContaining( { type: 'dir' } ),
			} )
		);
	} );

	it( 'keeps onboarding empty and points site scenarios at WordPress', async () => {
		const onboardingConnector = createMarketingConnector(
			getMarketingScenario( 'add-site' ),
			'light'
		);
		const previewConnector = createMarketingConnector(
			getMarketingScenario( 'agent-complete-preview' ),
			'light'
		);

		expect( await onboardingConnector.getSites() ).toEqual( [] );
		const previewSite = ( await previewConnector.getSites() ).find(
			( site ) => site.id === 'meridian'
		);
		expect( previewSite ).toMatchObject( {
			running: true,
			url: TEST_WORDPRESS_ORIGIN,
		} );
		const connectedConnector = createMarketingConnector(
			getMarketingScenario( 'connected-site-controls' ),
			'light'
		);
		const connectedSite = ( await connectedConnector.getSites() ).find(
			( site ) => site.id === 'meridian'
		);
		expect( connectedSite ).toMatchObject( {
			running: true,
			customDomain: undefined,
			enableHttps: false,
			url: TEST_WORDPRESS_ORIGIN,
		} );
	} );

	it( 'can point captures at an isolated real WordPress origin', async () => {
		const connector = createMarketingConnector(
			getMarketingScenario( 'agent-complete-preview' ),
			'light',
			undefined,
			{ previewOrigin: 'http://localhost:43210' }
		);
		const previewSite = ( await connector.getSites() ).find( ( site ) => site.id === 'meridian' );

		expect( previewSite?.url ).toBe( 'http://localhost:43210' );
		expect( connector.capabilities.annotatePreview ).toBe( false );
	} );

	it( 'applies requested initial closed panel states once', () => {
		const scenario = getMarketingScenario( 'agent-complete-preview' );
		const connector = createMarketingConnector( scenario, 'light', {
			sidebar: { state: 'collapsed', width: 300 },
			preview: { state: 'closed', widthRatio: 0.6 },
		} );
		const previewToggle = vi.fn();
		const sidebarToggle = vi.fn();

		connector.onToggleSitePreview( previewToggle );
		connector.onToggleSitePreview( previewToggle );
		connector.onToggleSidebar( sidebarToggle );
		connector.onToggleSidebar( sidebarToggle );

		expect( previewToggle ).toHaveBeenCalledOnce();
		expect( sidebarToggle ).toHaveBeenCalledOnce();
	} );
} );
