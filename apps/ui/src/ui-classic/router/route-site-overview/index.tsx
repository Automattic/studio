import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
	isSiteOverviewTab,
	SiteOverviewView,
	type SiteOverviewTabId,
} from '@/components/site-overview-view';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { dashboardLayoutRoute } from '../layout-dashboard';
import type { SiteDetails } from '@/data/core';

interface SiteOverviewSearch {
	tab?: SiteOverviewTabId;
	sync?: 'pull';
}

function SiteOverviewPage() {
	const { siteId } = siteOverviewRoute.useParams();
	const { tab, sync } = siteOverviewRoute.useSearch();
	const navigate = useNavigate();
	return (
		<SiteOverviewView
			siteId={ siteId }
			activeTab={ tab ?? 'overview' }
			openSiteDropdown={ sync === 'pull' }
			onTabChange={ ( next ) =>
				void navigate( {
					to: '/sites/$siteId/overview',
					params: { siteId },
					search: { tab: next },
					replace: true,
				} )
			}
		/>
	);
}

export const siteOverviewRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId/overview',
	validateSearch: ( search: Record< string, unknown > ): SiteOverviewSearch => {
		const validated: SiteOverviewSearch = {};
		if ( typeof search.tab === 'string' && isSiteOverviewTab( search.tab ) ) {
			validated.tab = search.tab;
		}
		if ( search.sync === 'pull' ) {
			validated.sync = 'pull';
		}
		return validated;
	},
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
