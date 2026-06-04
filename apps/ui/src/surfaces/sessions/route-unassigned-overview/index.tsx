import { createRoute } from '@tanstack/react-router';
import { UnassignedOverviewView } from '@/components/unassigned-overview-view';
import { dashboardLayoutRoute } from '@/surfaces/shell/layout-dashboard';

export const unassignedOverviewRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/unassigned',
	component: UnassignedOverviewView,
} );
