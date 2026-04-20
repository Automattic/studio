import { createRouter } from '@tanstack/react-router';
import { dashboardLayoutRoute } from './layout-dashboard';
import { onboardingLayoutRoute } from './layout-onboarding';
import { rootRoute } from './layout-root';
import { dashboardRoute } from './route-dashboard';
import { indexRoute } from './route-index';
import { newSessionRoute } from './route-new-session';
import { onboardingCreateRoute } from './route-onboarding-create';
import { onboardingHomeRoute } from './route-onboarding-home';
import { sessionDetailRoute } from './route-session-detail';
import { siteSettingsRoute } from './route-site-settings';
import type { RouterContext } from './layout-root';

const routeTree = rootRoute.addChildren( [
	indexRoute,
	dashboardLayoutRoute.addChildren( [
		dashboardRoute,
		newSessionRoute,
		sessionDetailRoute,
		siteSettingsRoute,
	] ),
	onboardingLayoutRoute.addChildren( [ onboardingHomeRoute, onboardingCreateRoute ] ),
] );

export function createAppRouter( context: RouterContext ) {
	return createRouter( {
		routeTree,
		context,
		defaultPreload: 'intent',
	} );
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType< typeof createAppRouter >;
	}
}
