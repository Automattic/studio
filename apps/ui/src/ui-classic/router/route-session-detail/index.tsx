import { createRoute } from '@tanstack/react-router';
import { SessionView } from '@/ui-classic/components/session-view';
import { validateComposerFocusSearch } from '../focus-composer-search';
import { dashboardLayoutRoute } from '../layout-dashboard';

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
