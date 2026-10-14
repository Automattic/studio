import { createRoute, redirect } from '@tanstack/react-router';
import { resolveAgenticFeatures } from '@/data/queries/use-agentic-features';
import { openNewSession } from '@/data/queries/use-sessions';
import { dashboardLayoutRoute } from '../layout-dashboard';

/**
 * Draft slot for a given site. We never actually render anything here — the
 * route eagerly asks the backend for an empty session, then redirects to
 * `/sessions/$sessionId`.
 */
export const newSessionRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId/new',
	beforeLoad: async ( { params, context } ) => {
		const { chatEnabled, chatPromptsSignIn } = await resolveAgenticFeatures( context );
		if ( ! chatEnabled ) {
			if ( chatPromptsSignIn ) {
				return;
			}
			throw redirect( {
				to: '/sites/$siteId/overview',
				params: { siteId: params.siteId },
			} );
		}

		const summary = await openNewSession( context, params.siteId );
		throw redirect( { to: '/sessions/$sessionId', params: { sessionId: summary.id } } );
	},
} );
