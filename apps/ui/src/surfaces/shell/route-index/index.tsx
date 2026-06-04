import { createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from '@/surfaces/shell/layout-root';

export const indexRoute = createRoute( {
	getParentRoute: () => rootRoute,
	path: '/',
	beforeLoad: () => {
		throw redirect( { to: '/sites' } );
	},
} );
