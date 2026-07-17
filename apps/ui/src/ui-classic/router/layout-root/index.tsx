import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { useAppMenuNavigation } from '@/hooks/use-app-menu-navigation';
import type { Connector } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

export interface RouterContext {
	queryClient: QueryClient;
	connector: Connector;
}

function AppMenuNavigation() {
	useAppMenuNavigation();
	return null;
}

export const rootRoute = createRootRouteWithContext< RouterContext >()( {
	component: () => (
		<>
			<AppMenuNavigation />
			<Outlet />
		</>
	),
} );
