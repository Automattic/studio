import { createRoute } from '@tanstack/react-router';
import { SessionView } from '@/ui-classic/components/session-view';
import { dashboardLayoutRoute } from '../layout-dashboard';

function SessionDetail() {
	const { sessionId } = sessionDetailRoute.useParams();
	return <SessionView sessionId={ sessionId } />;
}

export const sessionDetailRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sessions/$sessionId',
	component: SessionDetail,
} );
