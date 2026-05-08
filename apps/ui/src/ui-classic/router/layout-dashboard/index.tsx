import { createRoute, Outlet } from '@tanstack/react-router';
import { SidebarLayout } from '@/components/sidebar-layout';
import { rootRoute } from '../layout-root';

export const dashboardLayoutRoute = createRoute( {
	getParentRoute: () => rootRoute,
	id: 'dashboard-layout',
	component: () => (
		<SidebarLayout>
			<Outlet />
		</SidebarLayout>
	),
} );
