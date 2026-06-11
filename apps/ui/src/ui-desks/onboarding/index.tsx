import { createRoute, redirect } from '@tanstack/react-router';
import { OnboardingShell } from '@/ui-classic/router/layout-onboarding';
import {
	OnboardingBlueprintPage,
	validateBlueprintSearch,
} from '@/ui-classic/router/route-onboarding-blueprint';
import { OnboardingConnectPage } from '@/ui-classic/router/route-onboarding-connect';
import { CreateSitePage } from '@/ui-classic/router/route-onboarding-create';
import { OnboardingHomePage } from '@/ui-classic/router/route-onboarding-home';
import { OnboardingImportPage } from '@/ui-classic/router/route-onboarding-import';
import { desksRootRoute } from '../router/root';

/**
 * The desks surface has no site-creation flow of its own — it registers the
 * classic onboarding pages under its own route tree. The two redirect
 * routes below adapt the flow's exit points (`/dashboard` on close,
 * `/sites/$siteId/new` after creation) to their desks equivalents.
 */

export const desksOnboardingLayoutRoute = createRoute( {
	getParentRoute: () => desksRootRoute,
	id: 'desks-onboarding-layout',
	component: OnboardingShell,
} );

export const desksOnboardingHomeRoute = createRoute( {
	getParentRoute: () => desksOnboardingLayoutRoute,
	path: '/onboarding',
	component: OnboardingHomePage,
} );

export const desksOnboardingCreateRoute = createRoute( {
	getParentRoute: () => desksOnboardingLayoutRoute,
	path: '/onboarding/create',
	component: CreateSitePage,
} );

export const desksOnboardingBlueprintRoute = createRoute( {
	getParentRoute: () => desksOnboardingLayoutRoute,
	path: '/onboarding/blueprint',
	validateSearch: validateBlueprintSearch,
	component: OnboardingBlueprintPage,
} );

export const desksOnboardingConnectRoute = createRoute( {
	getParentRoute: () => desksOnboardingLayoutRoute,
	path: '/onboarding/connect',
	component: OnboardingConnectPage,
} );

export const desksOnboardingImportRoute = createRoute( {
	getParentRoute: () => desksOnboardingLayoutRoute,
	path: '/onboarding/import',
	component: OnboardingImportPage,
} );

export const desksDashboardRedirectRoute = createRoute( {
	getParentRoute: () => desksRootRoute,
	path: '/dashboard',
	beforeLoad: () => {
		throw redirect( { to: '/' } );
	},
} );

export const desksNewSiteRedirectRoute = createRoute( {
	getParentRoute: () => desksRootRoute,
	path: '/sites/$siteId/new',
	beforeLoad: ( { params } ) => {
		throw redirect( { to: '/sites/$siteId', params } );
	},
} );
