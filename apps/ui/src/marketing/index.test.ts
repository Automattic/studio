import { describe, expect, it, vi } from 'vitest';
import {
	PREVIEW_CONTENT_WIDTH_STORAGE_KEY,
	SIDEBAR_PANEL_STORAGE_KEY,
} from '@/lib/resizable-panels';
import {
	MARKETING_SCENARIO_IDS,
	applyMarketingPanelLayout,
	createMarketingConnector,
	getMarketingScenario,
	resolveMarketingPanelLayout,
} from './index';

describe( 'marketing screenshot scenarios', () => {
	it( 'registers stable routes and readiness selectors', () => {
		expect( MARKETING_SCENARIO_IDS ).toEqual( [
			'add-site',
			'site-overview',
			'agent-complete-preview',
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
				sidebar: { state: 'expanded', width: 320 },
				preview: { state: 'open', widthRatio: 0.55 },
			},
		} );
	} );

	it( 'rejects unknown scenario ids with the available choices', () => {
		expect( () => getMarketingScenario( 'missing' ) ).toThrow(
			'Expected one of: add-site, site-overview, agent-complete-preview'
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
		expect( scenario.panelLayout.preview.widthRatio ).toBe( 0.55 );
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
			contentWidth: 298,
			previewWidth: 365,
		},
		{
			viewportWidth: 1100,
			storedSidebarWidth: 275,
			renderedSidebarWidth: 275,
			contentWidth: 366,
			previewWidth: 447,
		},
		{
			viewportWidth: 1440,
			storedSidebarWidth: 320,
			renderedSidebarWidth: 320,
			contentWidth: 499,
			previewWidth: 609,
		},
		{
			viewportWidth: 1920,
			storedSidebarWidth: 320,
			renderedSidebarWidth: 320,
			contentWidth: 715,
			previewWidth: 873,
		},
	] )(
		'seeds a responsive preview-first split at $viewportWidth px',
		( { viewportWidth, storedSidebarWidth, renderedSidebarWidth, contentWidth, previewWidth } ) => {
			window.localStorage.clear();
			const applied = applyMarketingPanelLayout(
				getMarketingScenario( 'agent-complete-preview' ).panelLayout,
				viewportWidth
			);

			expect( applied ).toEqual( {
				sidebar: { state: 'expanded', width: renderedSidebarWidth },
				preview: {
					state: 'open',
					requestedWidthRatio: 0.55,
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
		] );
		expect( preferences.colorScheme ).toBe( 'dark' );
		expect( thumbnail ).toMatch( /^data:image\/svg\+xml/ );
		expect( storage?.total ).toBe( 191_889_408 );
		expect( fetchSpy ).not.toHaveBeenCalled();

		fetchSpy.mockRestore();
	} );

	it( 'provides a completed session only to the completed-agent scenario', async () => {
		const overviewConnector = createMarketingConnector(
			getMarketingScenario( 'site-overview' ),
			'light'
		);
		const agentConnector = createMarketingConnector(
			getMarketingScenario( 'agent-complete-preview' ),
			'light'
		);

		expect( await overviewConnector.getSessions() ).toEqual( [] );
		expect( await agentConnector.getSessions() ).toHaveLength( 1 );
		const session = await agentConnector.getSession( 'marketing-agent-complete' );
		expect( session.summary.ownerSiteName ).toBe( 'Meridian Coffee' );
		expect( session.entries ).toHaveLength( 7 );
	} );

	it( 'keeps onboarding empty and preview scenarios backed by the local fixture', async () => {
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
			url: window.location.origin,
		} );
	} );

	it( 'applies requested initial closed panel states once', () => {
		const scenario = getMarketingScenario( 'agent-complete-preview' );
		const connector = createMarketingConnector( scenario, 'light', {
			sidebar: { state: 'collapsed', width: 320 },
			preview: { state: 'closed', widthRatio: 0.55 },
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
