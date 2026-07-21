import { createRoute, redirect } from '@tanstack/react-router';
import { isSiteSettingsTab } from '@/components/site-settings-view';
import { dashboardLayoutRoute } from '../layout-dashboard';
import type { SiteSettingsTabId } from '@/components/site-settings-view';

interface SiteSettingsSearch {
	tab?: SiteSettingsTabId;
}

// The settings screen moved into the site overview (same tab ids); this route
// only keeps old deep links working.
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
	beforeLoad: ( { params, search } ) => {
		throw redirect( {
			to: '/sites/$siteId/overview',
			params,
			search,
			replace: true,
		} );
	},
} );
