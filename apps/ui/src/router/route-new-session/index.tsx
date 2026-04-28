import { createRoute, redirect } from '@tanstack/react-router';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { dashboardLayoutRoute } from '../layout-dashboard';

/**
 * Draft slot for a given site. We never actually render anything here — the
 * route eagerly asks the backend for (or reuses) an empty session, then
 * redirects to `/sessions/$sessionId`. The reuse happens inside the
 * `createSession` IPC handler, which returns the newest existing empty
 * session for the site if one exists, avoiding orphan sessions.
 */
export const newSessionRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId/new',
	beforeLoad: async ( { params, context } ) => {
		const summary = await context.connector.createSession( params.siteId );
		// Bypasses `useCreateSession`, so we need to invalidate the sessions
		// list ourselves — otherwise the sidebar wouldn't reflect the new
		// session on first render after the redirect. Fire-and-forget: the
		// refetch can happen in the background while we redirect immediately.
		void context.queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );
		throw redirect( { to: '/sessions/$sessionId', params: { sessionId: summary.id } } );
	},
} );
