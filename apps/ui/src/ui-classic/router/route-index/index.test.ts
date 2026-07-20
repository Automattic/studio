import { beforeEach, describe, expect, it } from 'vitest';
import { writeLastVisited } from '@/lib/last-visited';
import { indexRoute } from './index';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

function createSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	return {
		id: 'site-1',
		name: 'Site One',
		path: '/Users/example/Studio/site-one',
		port: 8881,
		running: false,
		phpVersion: '8.2',
		...overrides,
	};
}

function createSession( overrides: Partial< AiSessionSummary > = {} ): AiSessionSummary {
	return {
		id: 'session-1',
		filePath: '/tmp/session.jsonl',
		createdAt: '2026-06-26T11:00:00.000Z',
		updatedAt: '2026-06-26T11:00:00.000Z',
		ownerSiteId: 'site-1',
		ownerSitePath: '/Users/example/Studio/site-one',
		ownerSiteName: 'Site One',
		activeEnvironment: 'local',
		eventCount: 1,
		...overrides,
	};
}

async function runBeforeLoad( sites: SiteDetails[], sessions: AiSessionSummary[] ) {
	const context = {
		queryClient: {
			fetchQuery: ( { queryFn }: { queryFn: () => unknown } ) => queryFn(),
		},
		connector: {
			getSites: async () => sites,
			getSessions: async () => sessions,
			getAuthUser: async () => null,
			getOnboardingCompleted: async () => true,
		},
	};
	try {
		await indexRoute.options.beforeLoad?.( { context } as never );
	} catch ( thrown ) {
		return ( thrown as { options: { to: string; params?: Record< string, string > } } ).options;
	}
	throw new Error( 'Expected beforeLoad to throw a redirect' );
}

describe( 'indexRoute.beforeLoad', () => {
	beforeEach( () => {
		window.localStorage.clear();
	} );

	it( 'redirects to onboarding when there are no sites', async () => {
		const redirect = await runBeforeLoad( [], [] );
		expect( redirect.to ).toBe( '/onboarding' );
	} );

	it( "redirects to the last visited site's newest active session", async () => {
		writeLastVisited( { siteId: 'site-2' } );
		const redirect = await runBeforeLoad(
			[ createSite(), createSite( { id: 'site-2', path: '/Users/example/Studio/site-two' } ) ],
			[
				createSession(),
				createSession( { id: 'session-2', ownerSiteId: 'site-2', archived: true } ),
				createSession( { id: 'session-3', ownerSiteId: 'site-2' } ),
			]
		);
		expect( redirect.to ).toBe( '/sessions/$sessionId' );
		expect( redirect.params ).toEqual( { sessionId: 'session-3' } );
	} );

	it( 'falls back to the top site in sidebar order when the last visited site was deleted', async () => {
		writeLastVisited( { siteId: 'deleted-site' } );
		const redirect = await runBeforeLoad(
			[
				createSite(),
				createSite( { id: 'site-2', path: '/Users/example/Studio/site-two', sortOrder: 1000 } ),
			],
			[ createSession(), createSession( { id: 'session-2', ownerSiteId: 'site-2' } ) ]
		);
		expect( redirect.to ).toBe( '/sessions/$sessionId' );
		expect( redirect.params ).toEqual( { sessionId: 'session-2' } );
	} );

	it( 'falls back to the top site in sidebar order, not fetch order, when nothing is stored', async () => {
		const redirect = await runBeforeLoad(
			[
				createSite(),
				createSite( { id: 'site-2', path: '/Users/example/Studio/site-two', sortOrder: 1000 } ),
			],
			[ createSession(), createSession( { id: 'session-2', ownerSiteId: 'site-2' } ) ]
		);
		expect( redirect.to ).toBe( '/sessions/$sessionId' );
		expect( redirect.params ).toEqual( { sessionId: 'session-2' } );
	} );

	it( 'redirects to a new session when the target site has no active sessions', async () => {
		writeLastVisited( { siteId: 'site-2' } );
		const redirect = await runBeforeLoad(
			[ createSite(), createSite( { id: 'site-2', path: '/Users/example/Studio/site-two' } ) ],
			[
				createSession(),
				createSession( { id: 'session-2', ownerSiteId: 'site-2', archived: true } ),
			]
		);
		expect( redirect.to ).toBe( '/sites/$siteId/new' );
		expect( redirect.params ).toEqual( { siteId: 'site-2' } );
	} );
} );
