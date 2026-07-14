import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { isSiteSettingsTab, SiteSettingsView } from '@/components/site-settings-view';
import { useSites, SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { dashboardLayoutRoute } from '../layout-dashboard';
import type { SiteSettingsTabId } from '@/components/site-settings-view';
import type { SiteDetails } from '@/data/core';

interface SiteSettingsSearch {
	// Tab selection is a `search` param so opening the route defaults to
	// General and deep-links like `?tab=debugging` stay human-readable.
	tab?: SiteSettingsTabId;
}

function SiteSettingsPage() {
	const { siteId } = siteSettingsRoute.useParams();
	const { tab } = siteSettingsRoute.useSearch();
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const activeTab: SiteSettingsTabId = tab ?? 'general';

	const siteExists = sites?.some( ( site ) => site.id === siteId ) ?? true;
	useEffect( () => {
		if ( ! siteExists ) {
			void navigate( { to: '/' } );
		}
	}, [ siteExists, navigate ] );

	if ( ! siteExists ) {
		return null;
	}

	return (
		<SiteSettingsView
			siteId={ siteId }
			activeTab={ activeTab }
			onTabChange={ ( next ) =>
				void navigate( {
					to: '/sites/$siteId/settings',
					params: { siteId },
					search: { tab: next },
					replace: true,
				} )
			}
		/>
	);
}

export const siteSettingsRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId/settings',
	validateSearch: ( search: Record< string, unknown > ): SiteSettingsSearch => {
		const value = search.tab;
		if ( typeof value === 'string' && isSiteSettingsTab( value ) ) {
			return { tab: value };
		}
		return {};
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
	component: SiteSettingsPage,
} );
