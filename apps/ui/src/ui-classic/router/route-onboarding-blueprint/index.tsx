import { createRoute, redirect } from '@tanstack/react-router';
import { onboardingLayoutRoute } from '../layout-onboarding';

export const onboardingBlueprintRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/blueprint',
	beforeLoad: () => {
		throw redirect( { to: '/onboarding/create', replace: true } );
	},
} );
