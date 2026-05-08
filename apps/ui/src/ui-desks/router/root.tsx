import { createRootRoute, Outlet } from '@tanstack/react-router';
import { validateDeskChatsSearch } from '../chats/search';

export const desksRootRoute = createRootRoute< unknown >( {
	validateSearch: validateDeskChatsSearch,
	component: () => <Outlet />,
} );
