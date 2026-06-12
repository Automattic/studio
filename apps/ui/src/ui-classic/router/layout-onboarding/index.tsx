import { createRoute, Outlet, useMatches, useNavigate } from '@tanstack/react-router';
import { OnboardingLayout } from '@/components/onboarding-layout';
import { useSites } from '@/data/queries/use-sites';
import { rootRoute } from '../layout-root';

function OnboardingShell() {
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const hasSites = ( sites?.length ?? 0 ) > 0;
	// Grid-heavy pages (onboarding home with its flow picker cards, and the
	// blueprint selector's "select" step) need more horizontal room than the
	// single-column form pages; thread the variant through here so each child
	// route doesn't have to re-declare its own layout chrome. The blueprint
	// "configure" step reuses the shared site form and should match the
	// narrow "/onboarding/create" width.
	const matches = useMatches();
	const isWide = matches.some( ( match ) => {
		if ( match.pathname === '/onboarding' ) return true;
		if ( match.pathname !== '/onboarding/blueprint' ) return false;
		const step = ( match.search as { step?: string } ).step;
		return step !== 'configure';
	} );
	return (
		<OnboardingLayout
			onClose={ hasSites ? () => void navigate( { to: '/' } ) : undefined }
			width={ isWide ? 'wide' : 'default' }
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
