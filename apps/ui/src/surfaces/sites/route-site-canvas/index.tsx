import { createRoute, redirect } from '@tanstack/react-router';
import { dashboardLayoutRoute } from '@/surfaces/shell/layout-dashboard';

export const siteMapRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId/site-map',
	beforeLoad: ( { params } ) => {
		throw redirect( {
			to: '/sites/$siteId',
			params,
			replace: true,
		} );
	},
} );

export const legacySiteCanvasRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId/canvas',
	beforeLoad: ( { params } ) => {
		throw redirect( {
			to: '/sites/$siteId',
			params,
			replace: true,
		} );
	},
} );
