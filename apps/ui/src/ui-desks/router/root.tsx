import { createRootRoute, Outlet } from '@tanstack/react-router';
import { validateChatsSearch } from '../chats/search';

export const desksRootRoute = createRootRoute< unknown >( {
	validateSearch: validateChatsSearch,
	component: () => <Outlet />,
} );
