import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { chevronLeft } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { OnboardingFooter } from '@/components/onboarding-footer';
import {
	BuildNewSiteIllustration,
	illustrationHostClass,
} from '@/components/onboarding-illustrations';
import { useSites } from '@/data/queries/use-sites';
import { useOffline } from '@/hooks/use-offline';
import { onboardingLayoutRoute } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
import styles from './style.module.css';

export function OnboardingHomePage() {
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const isOffline = useOffline();
	const cardClass = `${ styles.card } ${ illustrationHostClass }`;

	return (
		<div className={ styles.page }>
			<h1 className={ sharedStyles.title }>{ __( 'Add a site' ) }</h1>
			<p className={ sharedStyles.subtitle }>
				{ __( 'Start fresh with a blank site or use a Blueprint.' ) }
			</p>
			<div className={ styles.cards }>
				<Link to="/onboarding/create" className={ cardClass }>
					<BuildNewSiteIllustration />
					<div className={ styles.cardText }>
						<h3 className={ styles.cardTitle }>{ __( 'Create a new site' ) }</h3>
						<p className={ styles.cardBody }>
							{ __(
								'Start from scratch or use a Blueprint. Perfect for theme and plugin development.'
							) }
						</p>
					</div>
				</Link>
			</div>
			{ ( sites?.length ?? 0 ) > 0 && (
				<OnboardingFooter>
					<Button
						type="button"
						variant="minimal"
						tone="neutral"
						onClick={ () => {
							const firstSiteId = sites?.[ 0 ]?.id;
							if ( isOffline && firstSiteId ) {
								void navigate( {
									to: '/sites/$siteId/settings',
									params: { siteId: firstSiteId },
								} );
							} else {
								void navigate( { to: '/' } );
							}
						} }
					>
						<Icon icon={ chevronLeft } size={ 16 } />
						<span>{ __( 'Back' ) }</span>
					</Button>
				</OnboardingFooter>
			) }
		</div>
	);
}

export const onboardingHomeRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding',
	component: OnboardingHomePage,
} );
