import { createRoute } from '@tanstack/react-router';
import { WordPressDataProvider } from '@/data/wordpress/provider';
import { Desk } from '../desk';
import { desksRootRoute } from '../router/root';

export function SiteDesk() {
	const { siteId } = siteDeskRoute.useParams();

	return (
		<WordPressDataProvider key={ siteId } siteId={ siteId }>
			<Desk siteId={ siteId } />
		</WordPressDataProvider>
	);
}

export const siteDeskRoute = createRoute( {
	getParentRoute: () => desksRootRoute,
	path: '/sites/$siteId',
	component: SiteDesk,
} );
