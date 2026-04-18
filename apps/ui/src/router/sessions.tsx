import { createRoute } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useSession } from '@/data/queries/use-sessions';
import { dashboardLayoutRoute } from './dashboard';

function SessionDetail() {
	const { sessionId } = sessionDetailRoute.useParams();
	const { data, isLoading, error } = useSession( sessionId );

	if ( isLoading ) {
		return <div style={ { padding: 24 } }>{ __( 'Loading session…' ) }</div>;
	}

	if ( error || ! data ) {
		return (
			<div style={ { padding: 24 } }>
				<h1>{ __( 'Session not found' ) }</h1>
				<p>{ sessionId }</p>
			</div>
		);
	}

	const { summary, events } = data;

	return (
		<div style={ { padding: 24 } }>
			<h1 style={ { marginBottom: 8 } }>
				{ summary.firstPrompt?.trim() || __( '(No prompt yet)' ) }
			</h1>
			<p style={ { marginBottom: 24, color: 'var(--wpds-color-fg-content-neutral-weak)' } }>
				{ summary.ownerSiteName ?? __( 'Unassigned' ) } · { events.length } { __( 'events' ) }
			</p>
			<p>
				{ __( 'AI chat UI will live here. For now this screen just confirms the session loaded.' ) }
			</p>
		</div>
	);
}

export const sessionDetailRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sessions/$sessionId',
	component: SessionDetail,
} );
