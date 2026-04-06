import { createRouter } from '@tanstack/react-router';
import { dashboardLayoutWithChildren } from './dashboard';
import { loginRoute } from './login';
import { onboardingRoute } from './onboarding';
import { rootRoute } from './root';
import { indexRoute } from './index';
import type { RouterContext } from './root';

const routeTree = rootRoute.addChildren( [
	indexRoute,
	loginRoute,
	dashboardLayoutWithChildren,
	onboardingRoute,
] );

export function createAppRouter( context: RouterContext ) {
	return createRouter( {
		routeTree,
		context,
		defaultPreload: 'intent',
	} );
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType< typeof createAppRouter >;
	}
}
