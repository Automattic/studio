import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useSession } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useOffline } from '@/hooks/use-offline';
import { SessionView } from '@/ui-classic/components/session-view';
import { dashboardLayoutRoute } from '../layout-dashboard';

function SessionDetail() {
	const { sessionId } = sessionDetailRoute.useParams();
	const navigate = useNavigate();
	const isOffline = useOffline();
	const { data: sessionData } = useSession( sessionId );
	const { data: sites } = useSites();

	useEffect( () => {
		if ( ! isOffline ) {
			return;
		}
		const ownerSite = findAiSessionOwnerSite( sites, sessionData?.summary );
		const siteId = ownerSite?.id ?? sites?.[ 0 ]?.id;
		if ( siteId ) {
			void navigate( {
				to: '/sites/$siteId/settings',
				params: { siteId },
			} );
		}
	}, [ isOffline, sites, sessionData, navigate ] );

	if ( isOffline ) {
		return null;
	}

	return <SessionView sessionId={ sessionId } />;
}

export const sessionDetailRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sessions/$sessionId',
	component: SessionDetail,
} );
