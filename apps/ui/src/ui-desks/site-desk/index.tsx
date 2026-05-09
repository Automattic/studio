import { createRoute } from '@tanstack/react-router';
import { Desk } from '../desk';
import { desksRootRoute } from '../router/root';

export function SiteDesk() {
	const { siteId } = siteDeskRoute.useParams();

	return <Desk siteId={ siteId } />;
}

export const siteDeskRoute = createRoute( {
	getParentRoute: () => desksRootRoute,
	path: '/sites/$siteId',
	component: SiteDesk,
} );
