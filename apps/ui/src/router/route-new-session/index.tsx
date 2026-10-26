import { createRoute, redirect } from '@tanstack/react-router';
import { openNewSession, SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { dashboardLayoutRoute } from '../layout-dashboard';

/**
 * Draft slot for a given site. We never actually render anything here — the
 * route reuses the site's empty chat, or asks the backend for one, then
 * redirects to `/sessions/$sessionId`.
 */
export const newSessionRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId/new',
	beforeLoad: async ( { params, context } ) => {
		const sessions = await context.queryClient
			.fetchQuery( {
				queryKey: SESSIONS_QUERY_KEY,
				queryFn: () => context.connector.getSessions(),
				staleTime: Infinity,
			} )
			.catch( () => [] );
		const emptySession = sessions.find(
			( session ) =>
				session.ownerSiteId === params.siteId &&
				! session.firstPrompt &&
				! session.title &&
				! session.archived
		);
		const summary = emptySession ?? ( await openNewSession( context, params.siteId ) );
		throw redirect( { to: '/sessions/$sessionId', params: { sessionId: summary.id } } );
	},
} );
