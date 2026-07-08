import { createRoute, useNavigate } from '@tanstack/react-router';
import { normalizeSettingsTab, SettingsView } from '@/components/settings-view';
import { settingsLayoutRoute } from '../layout-settings';
import type { SettingsTabId } from '@/components/settings-view';

interface SettingsSearch {
	// Tab selection is a `search` param so opening the route defaults to
	// preferences and deep-links like `?tab=usage` stay human-readable.
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
	getParentRoute: () => settingsLayoutRoute,
	path: '/settings',
	validateSearch: ( search: Record< string, unknown > ): SettingsSearch => {
		const value = search.tab;
		if ( typeof value === 'string' ) {
			return { tab: normalizeSettingsTab( value ) };
		}
		return {};
	},
	component: SettingsPage,
} );
