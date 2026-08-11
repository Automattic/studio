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

		// Capture new-vs-returning once, at the only moment they differ: a
		// brand-new user reaches here with no sites (then goes to /welcome), a
		// returning user arrives with sites already. Never overwrite once set,
		// and never let this block or break the redirect below.
		try {
			const hints = await context.connector.getOnboardingHints();
			if ( hints.returningUser === undefined ) {
				await context.connector.setOnboardingHints( { returningUser: sites.length > 0 } );
			}
		} catch {
			// Non-fatal: the checklist just falls back to the new-user set.
		}

		if ( sites.length === 0 ) {
			// Brand-new users see the first-run welcome (log in or skip) before
			// the add-a-site flow.
			const onboardingCompleted = await context.connector.getOnboardingCompleted();
			throw redirect( { to: onboardingCompleted ? '/onboarding' : '/welcome' } );
		}

		// Return the user to where they were (recorded by the dashboard
		// layout), validating against live data so stale ids from deleted
		// sessions/sites fall through to the defaults.
		const lastVisited = readLastVisited();

		// Without chat (signed out, offline, or disabled in settings), the site
		// overview is the home — never restore or create chat sessions.
		const { chatEnabled } = await resolveAgenticFeatures( context );
		if ( ! chatEnabled ) {
			const targetSite =
				( lastVisited.siteId && sites.find( ( site ) => site.id === lastVisited.siteId ) ) ||
				sites[ 0 ];
			throw redirect( { to: '/sites/$siteId/overview', params: { siteId: targetSite.id } } );
		}

		const sessions = await context.queryClient.fetchQuery( {
			queryKey: SESSIONS_QUERY_KEY,
			queryFn: () => context.connector.getSessions(),
		} );

		if ( lastVisited.sessionId ) {
			const lastSession = sessions.find(
				( session ) => session.id === lastVisited.sessionId && ! session.archived
			);
			if ( lastSession ) {
				throw redirect( { to: '/sessions/$sessionId', params: { sessionId: lastSession.id } } );
			}
		}
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
