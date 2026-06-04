import { createRoute } from '@tanstack/react-router';
import { SessionView } from '@/surfaces/sessions/session-view';
import { dashboardLayoutRoute } from '@/surfaces/shell/layout-dashboard';
import { validateComposerFocusSearch } from '../focus-composer-search';

function SessionDetail() {
	const { sessionId } = sessionDetailRoute.useParams();
	const { focusComposer } = sessionDetailRoute.useSearch();
	return <SessionView sessionId={ sessionId } autoFocusComposer={ focusComposer } />;
}

export const sessionDetailRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sessions/$sessionId',
	validateSearch: validateComposerFocusSearch,
	component: SessionDetail,
} );
