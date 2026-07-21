import { createRoute, redirect } from '@tanstack/react-router';
import { isSiteSettingsTab } from '@/components/site-settings-view';
import { settingsLayoutRoute } from '../layout-settings';
import type { SiteSettingsTabId } from '@/components/site-settings-view';

interface SiteSettingsSearch {
	// Tab selection is a `search` param so opening the route defaults to
	// Settings and deep-links like `?tab=agent` stay human-readable.
	tab?: SiteSettingsTabId;
}

export const siteSettingsRoute = createRoute( {
	getParentRoute: () => settingsLayoutRoute,
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
