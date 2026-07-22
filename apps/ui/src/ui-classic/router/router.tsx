import { createRouter } from '@tanstack/react-router';
import { createPackagedRouterHistory } from '@/app/router-history';
import { dashboardLayoutRoute } from './layout-dashboard';
import { onboardingLayoutRoute } from './layout-onboarding';
import { rootRoute } from './layout-root';
import { settingsLayoutRoute } from './layout-settings';
import { indexRoute } from './route-index';
import { newSessionRoute } from './route-new-session';
import { onboardingBlueprintRoute } from './route-onboarding-blueprint';
import { onboardingCreateRoute } from './route-onboarding-create';
import { onboardingHomeRoute } from './route-onboarding-home';
import { onboardingImportRoute } from './route-onboarding-import';
import { sessionDetailRoute } from './route-session-detail';
import { settingsRoute } from './route-settings';
import { siteOverviewRoute } from './route-site-overview';
import { siteSettingsRoute } from './route-site-settings';
import { welcomeRoute } from './route-welcome';
import type { RouterContext } from './layout-root';

const routeTree = rootRoute.addChildren( [
	indexRoute,
	welcomeRoute,
	dashboardLayoutRoute.addChildren( [
		newSessionRoute,
		sessionDetailRoute,
		siteOverviewRoute,
		siteSettingsRoute,
		settingsLayoutRoute.addChildren( [ settingsRoute ] ),
	] ),
	onboardingLayoutRoute.addChildren( [
		onboardingHomeRoute,
		onboardingCreateRoute,
		onboardingBlueprintRoute,
		onboardingImportRoute,
	] ),
] );

export function createAppRouter( context: RouterContext ) {
	return createRouter( {
		routeTree,
		context,
		defaultPreload: 'intent',
		history: createPackagedRouterHistory(),
	} );
}
