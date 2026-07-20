import { aiSessionBelongsToSite } from '@studio/common/ai/sessions/owner-site';
import { createRoute, redirect } from '@tanstack/react-router';
import { resolveAgenticFeatures } from '@/data/queries/use-agentic-features';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
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
		const topSession = sessions.find( ( session ) => aiSessionBelongsToSite( session, firstSite ) );
		if ( topSession ) {
			throw redirect( { to: '/sessions/$sessionId', params: { sessionId: topSession.id } } );
		}

		throw redirect( { to: '/sites/$siteId/new', params: { siteId: firstSite.id } } );
	},
} );
