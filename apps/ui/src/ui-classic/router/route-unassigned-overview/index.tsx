import { createRoute } from '@tanstack/react-router';
import { UnassignedOverviewView } from '@/components/unassigned-overview-view';
import { dashboardLayoutRoute } from '../layout-dashboard';

export const unassignedOverviewRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/unassigned',
	component: UnassignedOverviewView,
} );
