import { createRoute, redirect } from '@tanstack/react-router';
import { dashboardLayoutRoute } from '@/surfaces/shell/layout-dashboard';

export const siteThemeRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId/theme',
	beforeLoad: ( { params } ) => {
		throw redirect( {
			to: '/sites/$siteId',
			params,
			replace: true,
		} );
	},
} );
