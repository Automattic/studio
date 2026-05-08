import { createRootRoute, Outlet } from '@tanstack/react-router';

export const desksRootRoute = createRootRoute< unknown >( {
	component: () => <Outlet />,
} );
