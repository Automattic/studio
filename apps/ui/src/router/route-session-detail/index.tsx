import { createRoute } from '@tanstack/react-router';
import { SessionView } from '@/features/chats';
import { HeaderSidebarToggle } from '@/features/sidebar';
import { dashboardLayoutRoute } from '../layout-dashboard';

function SessionDetail() {
	const { sessionId } = sessionDetailRoute.useParams();
	const { message } = sessionDetailRoute.useSearch();
	return (
		<SessionView
			messageId={ message }
			sessionId={ sessionId }
			headerStart={ <HeaderSidebarToggle /> }
		/>
	);
}

export const sessionDetailRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sessions/$sessionId',
	validateSearch: ( search: Record< string, unknown > ) => ( {
		message: typeof search.message === 'string' ? search.message : undefined,
	} ),
	component: SessionDetail,
} );
