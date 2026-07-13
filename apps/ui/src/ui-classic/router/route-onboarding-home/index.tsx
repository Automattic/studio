import { createRoute, Link } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { onboardingLayoutRoute } from '../layout-onboarding';
import styles from '../layout-onboarding/style.module.css';

function OnboardingHomePage() {
	return (
		<div className={ styles.page }>
			<h1 className={ styles.title }>{ __( 'Start a new site' ) }</h1>
			<p className={ styles.subtitle }>
				{ __( 'WordPress can power anything. What are you building?' ) }
			</p>
			<div className={ styles.cards }>
				<Link to="/onboarding/create" className={ styles.card }>
					<h3 className={ styles.cardTitle }>{ __( 'Create' ) }</h3>
					<p className={ styles.cardBody }>
						{ __( 'Start blank or upload a Blueprint to preconfigure your site' ) }
					</p>
				</Link>
				<Link to="/onboarding/import" className={ styles.card }>
					<h3 className={ styles.cardTitle }>{ __( 'Import' ) }</h3>
					<p className={ styles.cardBody }>
						{ __( 'Import from a Jetpack backup or another full-site export' ) }
					</p>
				</Link>
			</div>
		</div>
	);
}

export const onboardingHomeRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding',
	component: OnboardingHomePage,
} );
