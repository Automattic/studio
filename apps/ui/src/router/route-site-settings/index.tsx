import { createRoute } from '@tanstack/react-router';
import { isSiteSettingsTab } from '@/components/site-settings-view';
import { dashboardLayoutRoute } from '../layout-dashboard';
import { assertSiteExists, useLeaveDeletedSite } from '../route-site-home';
import type { SiteSettingsTabId } from '@/components/site-settings-view';

interface SiteSettingsSearch {
	tab?: SiteSettingsTabId;
}

// The page itself renders in the dashboard layout's workspace, beside the preview.
function SiteSettings() {
	useLeaveDeletedSite( siteSettingsRoute.useParams().siteId );
	return null;
}

export const siteSettingsRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId/settings',
	validateSearch: ( search: Record< string, unknown > ): SiteSettingsSearch => {
		const value = search.tab;
		return typeof value === 'string' && isSiteSettingsTab( value ) ? { tab: value } : {};
	},
	beforeLoad: ( { params, context } ) => assertSiteExists( params.siteId, context ),
	component: SiteSettings,
} );
