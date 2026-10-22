import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useSites, SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { dashboardLayoutRoute } from '../layout-dashboard';
import type { RouterContext } from '../layout-root';
import type { SiteDetails } from '@/data/core';

// Leaves a site page whose site went away.
export function useLeaveDeletedSite( siteId: string ) {
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const siteExists = sites?.some( ( site ) => site.id === siteId ) ?? true;
	useEffect( () => {
		if ( ! siteExists ) {
			void navigate( { to: '/' } );
		}
	}, [ siteExists, navigate ] );
}

export async function assertSiteExists( siteId: string, context: RouterContext ) {
	const cachedSites = context.queryClient.getQueryData< SiteDetails[] >( SITES_QUERY_KEY );
	const sites = cachedSites?.some( ( site ) => site.id === siteId )
		? cachedSites
		: ( await context.queryClient.fetchQuery( {
				queryKey: SITES_QUERY_KEY,
				queryFn: () => context.connector.getSites(),
		  } ) ) ?? [];
	if ( ! sites.some( ( site: SiteDetails ) => site.id === siteId ) ) {
		throw redirect( { to: '/' } );
	}
}

// The site without chat: its preview fills the workspace (see the dashboard
// layout). Home for people who use Studio without Studio Code.
function SiteHome() {
	useLeaveDeletedSite( siteHomeRoute.useParams().siteId );
	return null;
}

export const siteHomeRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId',
	beforeLoad: ( { params, context } ) => assertSiteExists( params.siteId, context ),
	component: SiteHome,
} );
