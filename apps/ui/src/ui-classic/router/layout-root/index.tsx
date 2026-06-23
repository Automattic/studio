import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { useAddSiteListener } from '@/hooks/use-add-site-listener';
import { useMouseNavigation } from '@/hooks/use-mouse-navigation';
import type { Connector } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

export interface RouterContext {
	queryClient: QueryClient;
	connector: Connector;
}

function RootLayout() {
	useAddSiteListener();
	useMouseNavigation();
	return <Outlet />;
}

export const rootRoute = createRootRouteWithContext< RouterContext >()( {
	component: RootLayout,
} );
