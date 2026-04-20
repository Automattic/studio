import { createRoute } from '@tanstack/react-router';
import { NewSessionView } from '@/components/new-session-view';
import { dashboardLayoutRoute } from '../layout-dashboard';

function NewSessionPage() {
	const { siteId } = newSessionRoute.useParams();
	return <NewSessionView siteId={ siteId } />;
}

export const newSessionRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId/new',
	component: NewSessionPage,
} );
