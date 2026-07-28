import { createRoute, redirect } from '@tanstack/react-router';
import { SiteOverviewView } from '@/components/site-overview-view';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { dashboardLayoutRoute } from '../layout-dashboard';
import type { SiteDetails } from '@/data/core';

interface SiteOverviewSearch {
	sync?: 'pull';
}

function SiteOverviewPage() {
	const { siteId } = siteOverviewRoute.useParams();
	const { sync } = siteOverviewRoute.useSearch();
	return <SiteOverviewView siteId={ siteId } openSiteDropdown={ sync === 'pull' } />;
}

export const siteOverviewRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId/overview',
	validateSearch: ( search: Record< string, unknown > ): SiteOverviewSearch =>
		search.sync === 'pull' ? { sync: 'pull' } : {},
	beforeLoad: async ( { params, context } ) => {
		const sites = await context.queryClient.fetchQuery( {
			queryKey: SITES_QUERY_KEY,
			queryFn: () => context.connector.getSites(),
		} );
		if ( ! sites.some( ( site: SiteDetails ) => site.id === params.siteId ) ) {
			throw redirect( { to: '/' } );
		}
	},
	component: SiteOverviewPage,
} );
