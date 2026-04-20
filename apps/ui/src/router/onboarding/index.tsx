import { createRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { OnboardingLayout } from '@/components/onboarding-layout';
import { useSites } from '@/data/queries/use-sites';
import { rootRoute } from '../root';
import { CreateSitePage } from './create';
import { OnboardingHomePage } from './home';

function OnboardingShell() {
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const hasSites = ( sites?.length ?? 0 ) > 0;
	return (
		<OnboardingLayout
			onClose={ hasSites ? () => void navigate( { to: '/dashboard' } ) : undefined }
		>
			<Outlet />
		</OnboardingLayout>
	);
}

const onboardingLayoutRoute = createRoute( {
	getParentRoute: () => rootRoute,
	id: 'onboarding-layout',
	component: OnboardingShell,
} );

const onboardingIndexRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding',
	component: OnboardingHomePage,
} );

const onboardingCreateRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/create',
	component: CreateSitePage,
} );

export const onboardingRoute = onboardingLayoutRoute.addChildren( [
	onboardingIndexRoute,
	onboardingCreateRoute,
] );
