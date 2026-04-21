import { createRoute } from '@tanstack/react-router';
import { PreferencesTab } from '@/components/settings-view/preferences-tab';
import { settingsRoute } from '../route-settings';

export const settingsPreferencesRoute = createRoute( {
	getParentRoute: () => settingsRoute,
	path: '/preferences',
	component: PreferencesTab,
} );
