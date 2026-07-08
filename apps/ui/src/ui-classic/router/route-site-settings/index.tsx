import { createRoute, useNavigate } from '@tanstack/react-router';
import { isSiteSettingsTab, SiteSettingsView } from '@/components/site-settings-view';
import { settingsLayoutRoute } from '../layout-settings';
import type { SiteSettingsTabId } from '@/components/site-settings-view';

interface SiteSettingsSearch {
	// Tab selection is a `search` param so opening the route defaults to
	// General and deep-links like `?tab=debugging` stay human-readable.
	tab?: SiteSettingsTabId;
}

function SiteSettingsPage() {
	const { siteId } = siteSettingsRoute.useParams();
	const { tab } = siteSettingsRoute.useSearch();
	const navigate = useNavigate();
	const activeTab: SiteSettingsTabId = tab ?? 'general';
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
	getParentRoute: () => settingsLayoutRoute,
	path: '/sites/$siteId/settings',
	validateSearch: ( search: Record< string, unknown > ): SiteSettingsSearch => {
		const value = search.tab;
		if ( typeof value === 'string' && isSiteSettingsTab( value ) ) {
			return { tab: value };
		}
		return {};
	},
	component: SiteSettingsPage,
} );
