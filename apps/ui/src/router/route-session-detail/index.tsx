import { createRoute } from '@tanstack/react-router';
import { SessionView } from '@/features/chats';
import { HeaderSidebarToggle } from '@/features/sidebar';
import { dashboardLayoutRoute } from '../layout-dashboard';

function SessionDetail() {
	const { sessionId } = sessionDetailRoute.useParams();
	return <SessionView sessionId={ sessionId } headerStart={ <HeaderSidebarToggle /> } />;
}

export const sessionDetailRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sessions/$sessionId',
	component: SessionDetail,
} );
