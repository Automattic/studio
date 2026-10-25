import { aiSessionBelongsToSite } from '@studio/common/ai/sessions/owner-site';
import { sortSites } from '@studio/common/lib/sort-sites';
import { createRoute, redirect } from '@tanstack/react-router';
import { resolveChatEnabled } from '@/data/queries/use-agentic-features';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { SidebarLayout, readLastVisited, resumeChat } from '@/features/sidebar';
import { rootRoute } from '../layout-root';

// Without sites, the workspace offers Add site once, until a site exists again.
let addSiteOffered = false;

export const indexRoute = createRoute( {
	getParentRoute: () => rootRoute,
	path: '/',
	// The workspace shell shows, its sidebar loading, until the redirect.
	pendingComponent: () => <SidebarLayout>{ null }</SidebarLayout>,
	pendingMs: 0,
	pendingMinMs: 0,
	// Redirects carry the root search along, so Settings or Add site opened from
	// the shell isn't closed by them.
	beforeLoad: async ( { context, search } ) => {
		const sites = await context.queryClient
			.fetchQuery( {
				queryKey: SITES_QUERY_KEY,
				queryFn: () => context.connector.getSites(),
			} )
			.catch( () => null );
		// The empty workspace offers to load them again.
		if ( ! sites ) {
			throw redirect( { to: '/sites', search } );
		}
		const firstSite = sites[ 0 ];
		if ( ! firstSite ) {
			if ( ! ( await context.connector.getOnboardingCompleted() ) ) {
				throw redirect( { to: '/sites', search: { ...search, welcome: true } } );
			}
			const offer = ! addSiteOffered;
			addSiteOffered = true;
			throw redirect( { to: '/sites', search: offer ? { ...search, addSite: 'create' } : search } );
		}
		addSiteOffered = false;

		// Return the user to their last visited site (recorded by the dashboard
		// layout), validating against live data so a stale id from a deleted
		// site falls through to the sidebar's top site — not the raw fetch
		// order. `sortSites` sorts in place, so sort a copy.
		const lastVisited = readLastVisited();
		const targetSite =
			( lastVisited.siteId && sites.find( ( site ) => site.id === lastVisited.siteId ) ) ||
			sortSites( [ ...sites ] )[ 0 ];

		if ( ! ( await resolveChatEnabled( context ) ) ) {
			throw redirect( {
				to: '/sites/$siteId',
				params: { siteId: targetSite.id },
				search,
			} );
		}

		const sessions = await context.queryClient.fetchQuery( {
			queryKey: SESSIONS_QUERY_KEY,
			queryFn: () => context.connector.getSessions(),
		} );

		// Sessions arrive sorted newest-first, so without a chat to return to
		// the site opens its most recently updated active one.
		const topSession = resumeChat(
			targetSite.id,
			sessions.filter(
				( session ) => ! session.archived && aiSessionBelongsToSite( session, targetSite )
			)
		);
		if ( topSession ) {
			throw redirect( {
				to: '/sessions/$sessionId',
				params: { sessionId: topSession.id },
				search,
			} );
		}

		// No sessions yet: the new-session route creates an empty
		// session for the site and redirects to it.
		throw redirect( { to: '/sites/$siteId/new', params: { siteId: targetSite.id }, search } );
	},
} );
