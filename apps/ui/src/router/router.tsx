import { createRouter } from '@tanstack/react-router';
import { createPackagedRouterHistory } from '@/app/router-history';
import { dashboardLayoutRoute } from './layout-dashboard';
import { rootRoute } from './layout-root';
import { indexRoute } from './route-index';
import { newSessionRoute } from './route-new-session';
import { noSitesRoute } from './route-no-sites';
import { sessionDetailRoute } from './route-session-detail';
import { siteHomeRoute } from './route-site-home';
import type { RouterContext } from './layout-root';

const routeTree = rootRoute.addChildren( [
	indexRoute,
	dashboardLayoutRoute.addChildren( [
		newSessionRoute,
		noSitesRoute,
		sessionDetailRoute,
		siteHomeRoute,
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
