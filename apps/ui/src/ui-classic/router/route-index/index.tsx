import { aiSessionBelongsToSite } from '@studio/common/ai/sessions/owner-site';
import { sortSites } from '@studio/common/lib/sort-sites';
import { createRoute, redirect } from '@tanstack/react-router';
import { resolveAgenticFeatures } from '@/data/queries/use-agentic-features';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { readLastVisited } from '@/lib/last-visited';
import { rootRoute } from '../layout-root';

export const indexRoute = createRoute( {
	getParentRoute: () => rootRoute,
	path: '/',
	beforeLoad: async ( { context } ) => {
		const sites = await context.queryClient.fetchQuery( {
			queryKey: SITES_QUERY_KEY,
			queryFn: () => context.connector.getSites(),
		} );
		const firstSite = sites[ 0 ];
		if ( ! firstSite ) {
			const onboardingCompleted = await context.connector.getOnboardingCompleted();
			throw redirect( { to: onboardingCompleted ? '/onboarding' : '/welcome' } );
		}

		const { enabled: agenticEnabled } = await resolveAgenticFeatures( context );
		if ( ! agenticEnabled ) {
			throw redirect( {
				to: '/sites/$siteId/settings',
				params: { siteId: firstSite.id },
			} );
		}

		const sessions = await context.queryClient.fetchQuery( {
			queryKey: SESSIONS_QUERY_KEY,
			queryFn: () => context.connector.getSessions(),
		} );

		// Return the user to their last visited site (recorded by the dashboard
		// layout), validating against live data so a stale id from a deleted
		// site falls through to the sidebar's top site — not the raw fetch
		// order. `sortSites` sorts in place, so sort a copy.
		const lastVisited = readLastVisited();
		const targetSite =
			( lastVisited.siteId && sites.find( ( site ) => site.id === lastVisited.siteId ) ) ||
			sortSites( [ ...sites ] )[ 0 ];

		// Sessions arrive sorted newest-first, so the first session owned by
		// the site is its most recently updated active one.
		const topSession = sessions.find(
			( session ) => ! session.archived && aiSessionBelongsToSite( session, targetSite )
		);
		if ( topSession ) {
			throw redirect( { to: '/sessions/$sessionId', params: { sessionId: topSession.id } } );
		}

		// No sessions yet: the new-session route creates (or reuses) an empty
		// session for the site and redirects to it.
		throw redirect( { to: '/sites/$siteId/new', params: { siteId: targetSite.id } } );
	},
} );
