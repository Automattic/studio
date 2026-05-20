import { RouterProvider, createRouter } from '@tanstack/react-router';
import { useMemo } from 'react';
import { createPackagedRouterHistory } from '@/app/router-history';
import {
	desksOnboardingBlueprintRoute,
	desksOnboardingCreateRoute,
	desksOnboardingHomeRoute,
	desksOnboardingImportRoute,
} from './onboarding';
import { desksRootRoute } from './router/root';
import { siteDeskRoute } from './site-desk';
import { userDeskRoute } from './user-desk';

const routeTree = desksRootRoute.addChildren( [
	userDeskRoute,
	siteDeskRoute,
	desksOnboardingHomeRoute,
	desksOnboardingCreateRoute,
	desksOnboardingBlueprintRoute,
	desksOnboardingImportRoute,
] );

export function createDesksRouter() {
	return createRouter( {
		routeTree,
		defaultPreload: 'intent',
		history: createPackagedRouterHistory(),
	} );
}

export function DesksUiApp() {
	const router = useMemo( () => createDesksRouter(), [] );

	return (
		<div data-ui-mode="desks">
			<RouterProvider router={ router } />
		</div>
	);
}
