import { Navigate, createRootRoute, Outlet } from '@tanstack/react-router';

function ResetToUserDesk() {
	return <Navigate to="/" replace />;
}

export const desksRootRoute = createRootRoute< unknown >( {
	component: () => <Outlet />,
	notFoundComponent: ResetToUserDesk,
} );
