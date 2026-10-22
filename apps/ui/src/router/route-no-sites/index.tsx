import { createRoute } from '@tanstack/react-router';
import { dashboardLayoutRoute } from '../layout-dashboard';

// The workspace before the first site: the sidebar's "+" and the Add site
// dialog over an empty frame.
export const noSitesRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites',
	component: () => null,
} );
