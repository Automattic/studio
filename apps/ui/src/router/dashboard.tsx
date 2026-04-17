import { createRoute, Outlet } from '@tanstack/react-router';
import { __, _n, sprintf } from '@wordpress/i18n';
import { SidebarLayout } from '@/components/sidebar-layout';
import { useSites } from '@/data/queries/use-sites';
import { rootRoute } from './root';

const dashboardLayoutRoute = createRoute( {
	getParentRoute: () => rootRoute,
	id: 'dashboard-layout',
	component: () => (
		<SidebarLayout>
			<Outlet />
		</SidebarLayout>
	),
} );

function DashboardHome() {
	const { data: sites } = useSites();
	const count = sites?.length ?? 0;

	return (
		<div style={ { padding: 24 } }>
			<h1>{ __( 'Dashboard' ) }</h1>
			<p>{ sprintf( _n( '%d site', '%d sites', count ), count ) }</p>
		</div>
	);
}

const dashboardRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/dashboard',
	component: DashboardHome,
} );

export const dashboardLayoutWithChildren = dashboardLayoutRoute.addChildren( [ dashboardRoute ] );
