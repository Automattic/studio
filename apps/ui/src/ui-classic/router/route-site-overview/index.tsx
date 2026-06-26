import { createRoute } from '@tanstack/react-router';
import { SiteOverviewView } from '@/components/site-overview-view';
import { dashboardLayoutRoute } from '../layout-dashboard';

function SiteOverviewPage() {
	const { siteId } = siteOverviewRoute.useParams();
	return <SiteOverviewView siteId={ siteId } />;
}

export const siteOverviewRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId/overview',
	component: SiteOverviewPage,
} );
