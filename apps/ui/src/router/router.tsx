import { createRouter } from '@tanstack/react-router';
import { createPackagedRouterHistory } from '@/app/router-history';
import { dashboardLayoutRoute } from './layout-dashboard';
import { onboardingLayoutRoute } from './layout-onboarding';
import { rootRoute } from './layout-root';
import { indexRoute } from './route-index';
import { newSessionRoute } from './route-new-session';
import { onboardingBlueprintRoute } from './route-onboarding-blueprint';
import { onboardingConnectRoute } from './route-onboarding-connect';
import { onboardingCreateRoute } from './route-onboarding-create';
import { onboardingHomeRoute } from './route-onboarding-home';
import { onboardingImportRoute } from './route-onboarding-import';
import { onboardingTourRoute } from './route-onboarding-tour';
import { sessionDetailRoute } from './route-session-detail';
import { siteHomeRoute } from './route-site-home';
import { welcomeRoute } from './route-welcome';
import type { RouterContext } from './layout-root';

const routeTree = rootRoute.addChildren( [
	indexRoute,
	welcomeRoute,
	dashboardLayoutRoute.addChildren( [ newSessionRoute, sessionDetailRoute, siteHomeRoute ] ),
	onboardingLayoutRoute.addChildren( [
		onboardingHomeRoute,
		onboardingTourRoute,
		onboardingConnectRoute,
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
