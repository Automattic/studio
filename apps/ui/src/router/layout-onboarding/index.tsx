import { createRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { OnboardingLayout } from '@/components/onboarding-layout';
import { useSites } from '@/data/queries/use-sites';
import { rootRoute } from '../layout-root';

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

export const onboardingLayoutRoute = createRoute( {
	getParentRoute: () => rootRoute,
	id: 'onboarding-layout',
	component: OnboardingShell,
} );
