import { createRouter } from '@tanstack/react-router';
import { createPackagedRouterHistory } from '@/app/router-history';
import { dashboardLayoutRoute } from './layout-dashboard';
import { onboardingLayoutRoute } from './layout-onboarding';
import { rootRoute } from './layout-root';
import { indexRoute } from './route-index';
import { newSessionRoute } from './route-new-session';
import { onboardingAiRoute } from './route-onboarding-ai';
import { onboardingConnectRoute } from './route-onboarding-connect';
import { onboardingCreateRoute } from './route-onboarding-create';
import { onboardingHomeRoute } from './route-onboarding-home';
import { onboardingImportRoute } from './route-onboarding-import';
import { onboardingPluginRoute } from './route-onboarding-plugin';
import { onboardingPluginConnectRoute } from './route-onboarding-plugin-connect';
import { onboardingPluginCreateRoute } from './route-onboarding-plugin-create';
import { onboardingTourRoute } from './route-onboarding-tour';
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
		settingsRoute,
	] ),
	onboardingLayoutRoute.addChildren( [
		onboardingTourRoute,
		onboardingAiRoute,
		onboardingHomeRoute,
		onboardingCreateRoute,
		onboardingConnectRoute,
		onboardingImportRoute,
		onboardingPluginRoute,
		onboardingPluginCreateRoute,
		onboardingPluginConnectRoute,
	] ),
] );

export function createAppRouter( context: RouterContext ) {
	return createRouter( {
		routeTree,
		context,
		defaultPreload: 'intent',
		// Only animate navigations within the site-creation onboarding flow.
		// Returning false skips document.startViewTransition entirely for every
		// other navigation (e.g. switching sites/sessions), so the rest of the
		// app navigates instantly instead of running the root fade/slide.
		defaultViewTransition: {
			types: ( { toLocation } ) =>
				toLocation.pathname.startsWith( '/onboarding' ) ? [ 'onboarding' ] : false,
		},
		history: createPackagedRouterHistory(),
	} );
}
