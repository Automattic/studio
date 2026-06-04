import { createRouter } from '@tanstack/react-router';
import { createPackagedRouterHistory } from '@/app/router-history';
import { onboardingLayoutRoute } from '@/surfaces/onboarding/layout';
import { onboardingBlueprintRoute } from '@/surfaces/onboarding/route-blueprint';
import { onboardingCreateRoute } from '@/surfaces/onboarding/route-create';
import { onboardingHomeRoute } from '@/surfaces/onboarding/route-home';
import { onboardingImportRoute } from '@/surfaces/onboarding/route-import';
import { newSessionRoute } from '@/surfaces/sessions/route-new-session';
import { sessionDetailRoute } from '@/surfaces/sessions/route-session-detail';
import { unassignedOverviewRoute } from '@/surfaces/sessions/route-unassigned-overview';
import { settingsRoute } from '@/surfaces/settings/route-settings';
import { legacySiteCanvasRoute, siteMapRoute } from '@/surfaces/sites/route-site-canvas';
import { siteOverviewRoute } from '@/surfaces/sites/route-site-overview';
import { siteSettingsRoute } from '@/surfaces/sites/route-site-settings';
import { siteThemeRoute } from '@/surfaces/sites/route-site-theme';
import { sitesRoute } from '@/surfaces/sites/route-sites';
import { dashboardLayoutRoute } from './layout-dashboard';
import { rootRoute } from './layout-root';
import { indexRoute } from './route-index';
import type { RouterContext } from './layout-root';

const routeTree = rootRoute.addChildren( [
	indexRoute,
	dashboardLayoutRoute.addChildren( [
		sitesRoute,
		newSessionRoute,
		sessionDetailRoute,
		siteOverviewRoute,
		siteMapRoute,
		siteThemeRoute,
		legacySiteCanvasRoute,
		siteSettingsRoute,
		settingsRoute,
		unassignedOverviewRoute,
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
