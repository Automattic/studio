import { createRoute, redirect } from '@tanstack/react-router';
import { resolveChatEnabled } from '@/data/queries/use-agentic-features';
import { SessionView } from '@/features/chats';
import { dashboardLayoutRoute } from '../layout-dashboard';

function SessionDetail() {
	const { sessionId } = sessionDetailRoute.useParams();
	return <SessionView sessionId={ sessionId } />;
}

export const sessionDetailRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sessions/$sessionId',
	component: SessionDetail,
	beforeLoad: async ( { context } ) => {
		if ( ! ( await resolveChatEnabled( context ) ) ) {
			throw redirect( { to: '/' } );
		}
	},
} );
