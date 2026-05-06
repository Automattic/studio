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
					<h3 className={ styles.cardTitle }>{ __( 'Create new' ) }</h3>
					<p className={ styles.cardBody }>
						{ __( 'Start fresh with a blank site and build it with AI' ) }
					</p>
				</Link>
				<Link to="/onboarding/blueprint" className={ styles.card }>
					<h3 className={ styles.cardTitle }>{ __( 'Start from a blueprint' ) }</h3>
					<p className={ styles.cardBody }>
						{ __(
							'Pick a featured blueprint or drop in your own to provision plugins, content, and settings.'
						) }
					</p>
				</Link>
				<Link to="/onboarding/import" className={ styles.card }>
					<h3 className={ styles.cardTitle }>{ __( 'Bring existing' ) }</h3>
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
