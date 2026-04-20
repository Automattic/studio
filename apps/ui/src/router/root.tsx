import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { Connector } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

export interface RouterContext {
	queryClient: QueryClient;
	connector: Connector;
}

export const rootRoute = createRootRouteWithContext< RouterContext >()( {
	component: () => <Outlet />,
} );
