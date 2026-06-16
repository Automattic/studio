import { createRoute, redirect } from '@tanstack/react-router';
import { OnboardingShell } from '@/ui-classic/router/layout-onboarding';
import {
	OnboardingBlueprintPage,
	validateBlueprintSearch,
} from '@/ui-classic/router/route-onboarding-blueprint';
import { CreateSitePage } from '@/ui-classic/router/route-onboarding-create';
import { OnboardingHomePage } from '@/ui-classic/router/route-onboarding-home';
import {
	OnboardingImportPage,
	validateImportSearch,
} from '@/ui-classic/router/route-onboarding-import';
import { desksRootRoute } from '../router/root';

/**
 * The desks surface has no site-creation flow of its own. It registers the
 * classic onboarding pages under its own route tree, then adapts the flow's
 * exit URLs to their desks equivalents.
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

export const desksOnboardingImportRoute = createRoute( {
	getParentRoute: () => desksOnboardingLayoutRoute,
	path: '/onboarding/import',
	validateSearch: validateImportSearch,
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
