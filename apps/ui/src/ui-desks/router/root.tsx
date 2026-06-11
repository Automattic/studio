import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useAddSiteListener } from '@/hooks/use-add-site-listener';
import { validateChatsSearch } from '../chats/search';

function DesksRootLayout() {
	// Same external "add a site" entry points as the classic root: the
	// File ▸ Add Site… menu item and `wp-studio://add-site` deep links land
	// on the shared onboarding flow.
	useAddSiteListener();
	return <Outlet />;
}

export const desksRootRoute = createRootRoute< unknown >( {
	validateSearch: validateChatsSearch,
	component: DesksRootLayout,
} );
