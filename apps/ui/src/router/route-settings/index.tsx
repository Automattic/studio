import { createRoute, useNavigate } from '@tanstack/react-router';
import { isSettingsTab, SettingsView } from '@/components/settings-view';
import { dashboardLayoutRoute } from '../layout-dashboard';
import type { SettingsTabId } from '@/components/settings-view';

interface SettingsSearch {
	// Tab selection is a `search` param so opening the route defaults to
	// preferences and deep-links like `?tab=account` stay human-readable.
	// Mirrors the shape used by the site-settings route.
	tab?: SettingsTabId;
}

function SettingsPage() {
	const { tab } = settingsRoute.useSearch();
	const navigate = useNavigate();
	const activeTab: SettingsTabId = tab ?? 'preferences';
	return (
		<SettingsView
			activeTab={ activeTab }
			onTabChange={ ( next ) =>
				void navigate( {
					to: '/settings',
					search: { tab: next },
					replace: true,
				} )
			}
		/>
	);
}

export const settingsRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/settings',
	validateSearch: ( search: Record< string, unknown > ): SettingsSearch => {
		const value = search.tab;
		if ( typeof value === 'string' && isSettingsTab( value ) ) {
			return { tab: value };
		}
		return {};
	},
	component: SettingsPage,
} );
