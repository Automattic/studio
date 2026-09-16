import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { SessionView } from '@/components/session-view';
import { resolveAgenticFeatures, useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { dashboardLayoutRoute } from '../layout-dashboard';

function SessionDetail() {
	const { sessionId } = sessionDetailRoute.useParams();
	const navigate = useNavigate();
	const { isReady, chatEnabled } = useAgenticFeatures();

	useEffect( () => {
		if ( isReady && ! chatEnabled ) {
			void navigate( { to: '/' } );
		}
	}, [ isReady, chatEnabled, navigate ] );

	return <SessionView sessionId={ sessionId } />;
}

export const sessionDetailRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sessions/$sessionId',
	component: SessionDetail,
	beforeLoad: async ( { context } ) => {
		const { chatEnabled } = await resolveAgenticFeatures( context );
		if ( ! chatEnabled ) {
			throw redirect( { to: '/' } );
		}
	},
} );
