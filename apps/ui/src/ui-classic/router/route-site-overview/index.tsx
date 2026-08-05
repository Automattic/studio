import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { SiteOverviewView } from '@/components/site-overview-view';
import { isSiteSettingsTab } from '@/components/site-settings-view';
import { useSites, SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { dashboardLayoutRoute } from '../layout-dashboard';
import type { SiteSettingsTabId } from '@/components/site-settings-view';
import type { SiteWorkspaceTabId } from '@/components/site-workspace-shell';
import type { SiteDetails } from '@/data/core';

interface SiteOverviewSearch {
	// Tab selection remains a search param so site routes are directly linkable.
	tab?: SiteSettingsTabId;
	sync?: 'pull';
}

function SiteOverviewPage() {
	const { siteId } = siteOverviewRoute.useParams();
	const { tab } = siteOverviewRoute.useSearch();
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const activeTab: Exclude< SiteWorkspaceTabId, 'chat' > = tab ?? 'overview';

	const siteExists = sites?.some( ( site ) => site.id === siteId ) ?? true;
	useEffect( () => {
		if ( ! siteExists ) {
			void navigate( { to: '/' } );
		}
	}, [ siteExists, navigate ] );

	if ( ! siteExists ) {
		return null;
	}

	return <SiteOverviewView siteId={ siteId } activeTab={ activeTab } />;
}

export const siteOverviewRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId/overview',
	validateSearch: ( search: Record< string, unknown > ): SiteOverviewSearch => {
		const validated: SiteOverviewSearch = {};
		const value = search.tab;
		// Preserve old Debugging deep links now that those controls live at the
		// bottom of Settings.
		if ( value === 'debugging' ) {
			validated.tab = 'general';
		} else if ( typeof value === 'string' && isSiteSettingsTab( value ) ) {
			validated.tab = value;
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
