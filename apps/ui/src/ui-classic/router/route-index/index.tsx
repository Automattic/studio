import { createRoute, redirect } from '@tanstack/react-router';
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

		if ( firstSite ) {
			throw redirect( { to: '/sites/$siteId', params: { siteId: firstSite.id } } );
		}

		throw redirect( { to: '/onboarding' } );
	},
} );
