import { createRoute } from '@tanstack/react-router';
import { dashboardLayoutRoute } from '../layout-dashboard';

export const indexRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/',
} );
