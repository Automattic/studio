import { describe, expect, it, vi } from 'vitest';
import { MARKETING_SCENARIO_IDS, createMarketingConnector, getMarketingScenario } from './index';

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
		} );
	} );

	it( 'rejects unknown scenario ids with the available choices', () => {
		expect( () => getMarketingScenario( 'missing' ) ).toThrow(
			'Expected one of: add-site, site-overview, agent-complete-preview'
		);
	} );
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
} );
