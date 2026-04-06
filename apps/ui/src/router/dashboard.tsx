import { createRoute, Outlet } from '@tanstack/react-router';
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

	return (
		<div style={ { padding: 24 } }>
			<h1>Dashboard</h1>
			<p>{ sites?.length ?? 0 } site(s)</p>
		</div>
	);
}

const dashboardRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/dashboard',
	component: DashboardHome,
} );

export const dashboardLayoutWithChildren = dashboardLayoutRoute.addChildren( [ dashboardRoute ] );
