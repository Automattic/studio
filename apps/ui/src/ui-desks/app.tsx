import { RouterProvider, createRouter } from '@tanstack/react-router';
import { useMemo } from 'react';
import { createPackagedRouterHistory } from '@/app/router-history';
import {
	desksDashboardRedirectRoute,
	desksNewSiteRedirectRoute,
	desksOnboardingBlueprintRoute,
	desksOnboardingConnectRoute,
	desksOnboardingCreateRoute,
	desksOnboardingHomeRoute,
	desksOnboardingImportRoute,
	desksOnboardingLayoutRoute,
} from './onboarding';
import { desksRootRoute } from './router/root';
import { siteDeskRoute } from './site-desk';
import { desksSiteSettingsRoute } from './site-settings';
import { userDeskRoute } from './user-desk';

const routeTree = desksRootRoute.addChildren( [
	userDeskRoute,
	desksSiteSettingsRoute,
	siteDeskRoute,
	desksOnboardingLayoutRoute.addChildren( [
		desksOnboardingHomeRoute,
		desksOnboardingCreateRoute,
		desksOnboardingBlueprintRoute,
		desksOnboardingConnectRoute,
		desksOnboardingImportRoute,
	] ),
	desksDashboardRedirectRoute,
	desksNewSiteRedirectRoute,
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
