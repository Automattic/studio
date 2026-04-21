import { createRoute } from '@tanstack/react-router';
import { PreferencesTab } from '@/components/settings-view/preferences-tab';
import { settingsLayoutRoute } from '../layout-settings';

export const settingsPreferencesRoute = createRoute( {
	getParentRoute: () => settingsLayoutRoute,
	path: '/settings/preferences',
	component: PreferencesTab,
} );
