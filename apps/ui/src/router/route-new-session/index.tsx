import { createRoute } from '@tanstack/react-router';
import { dashboardLayoutRoute } from '../layout-dashboard';
import { assertSiteExists } from '../route-site-home';

export const newSessionRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId/new',
	beforeLoad: ( { params, context } ) => assertSiteExists( params.siteId, context ),
	component: () => null,
} );
