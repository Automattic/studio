import {
	aiSessionBelongsToSite,
	findAiSessionOwnerSite,
} from '@studio/common/ai/sessions/owner-site';
import { sortSites } from '@studio/common/lib/sort-sites';
import { createRoute, redirect } from '@tanstack/react-router';
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
		if ( sites.length === 0 ) {
			throw redirect( { to: '/onboarding' } );
		}

		const sessions = await context.queryClient.fetchQuery( {
			queryKey: SESSIONS_QUERY_KEY,
			queryFn: () => context.connector.getSessions(),
		} );

		// Return the user to where they were (recorded by the dashboard
		// layout), validating against live data so stale ids from deleted
		// sessions/sites fall through to the defaults.
		const lastVisited = readLastVisited();
		if ( lastVisited.sessionId ) {
			const lastSession = sessions.find(
				( session ) => session.id === lastVisited.sessionId && ! session.archived
			);
			// Only restore sessions whose owner site still exists; landing on an
			// orphaned session at launch is disorienting even though the session
			// view renders it.
			if ( lastSession && findAiSessionOwnerSite( sites, lastSession ) ) {
				throw redirect( { to: '/sessions/$sessionId', params: { sessionId: lastSession.id } } );
			}
		}
		// Fall back to the sidebar's top site, not the raw fetch order.
		// `sortSites` sorts in place, so sort a copy.
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
