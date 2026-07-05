import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { resolveAgenticFeatures, useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { setVisibleSessionId } from '@/lib/visible-session';
import { SessionView } from '@/ui-classic/components/session-view';
import { dashboardLayoutRoute } from '../layout-dashboard';

function SessionDetail() {
	const { sessionId } = sessionDetailRoute.useParams();
	const navigate = useNavigate();
	const { enabled, isReady } = useAgenticFeatures();

	// Lets the chat-notifications watcher suppress notifications for the
	// conversation the user is already looking at.
	useEffect( () => {
		setVisibleSessionId( sessionId );
		return () => setVisibleSessionId( null );
	}, [ sessionId ] );

	// beforeLoad only runs on navigation; this catches the gate flipping while
	// the chat is already open (signing out mid-chat, or toggling agentic
	// features off in settings). The index route re-resolves to the right
	// site overview.
	useEffect( () => {
		if ( isReady && ! enabled ) {
			void navigate( { to: '/' } );
		}
	}, [ isReady, enabled, navigate ] );

	return <SessionView sessionId={ sessionId } />;
}

export const sessionDetailRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sessions/$sessionId',
	beforeLoad: async ( { context } ) => {
		const { enabled } = await resolveAgenticFeatures( context );
		if ( ! enabled ) {
			// The index route owns the "where should a gated user land"
			// decision, so defer to it rather than duplicating the
			// session-to-site lookup here.
			throw redirect( { to: '/' } );
		}
	},
	component: SessionDetail,
} );
