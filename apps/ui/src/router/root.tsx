import { createRootRouteWithContext, Outlet, redirect } from '@tanstack/react-router';
import type { Connector } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

export interface RouterContext {
	queryClient: QueryClient;
	connector: Connector;
}

const PUBLIC_PATHS = [ '/login' ];

export const rootRoute = createRootRouteWithContext< RouterContext >()( {
	beforeLoad: async ( { context, location } ) => {
		const { connector } = context;

		if ( connector.requiresAuth && ! PUBLIC_PATHS.includes( location.pathname ) ) {
			const authenticated = await connector.isAuthenticated();
			if ( ! authenticated ) {
				throw redirect( { to: '/login' } );
			}
		}
	},
	component: () => <Outlet />,
} );
