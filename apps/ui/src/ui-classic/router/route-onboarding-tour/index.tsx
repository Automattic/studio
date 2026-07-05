import { createRoute, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { check, Icon } from '@wordpress/icons';
import { useCallback } from 'react';
import { useConnector } from '@/data/core';
import { WizardPage } from '../../components/wizard-page';
import { onboardingLayoutRoute } from '../layout-onboarding';
// The checkmark feature-list styles are shared with the welcome screen so
// the two can't drift apart visually.
import welcomeStyles from '../route-welcome/style.module.css';
import styles from './style.module.css';

const STEPS = [
	{
		title: __( 'Sites run right on your machine' ),
		subtitle: __( 'Every Studio site is a full WordPress install that lives locally.' ),
		points: [
			{
				title: __( 'Start and stop anytime' ),
				body: __( 'Run only what you need. Each site has its own settings and WordPress version.' ),
			},
			{
				title: __( 'Share previews' ),
				body: __(
					'Put a copy of your site on a temporary preview link. Previews expire automatically.'
				),
			},
			{
				title: __( 'Sync with live sites' ),
				body: __( 'Connect to WordPress.com or Pressable, then push or pull changes anytime.' ),
			},
		],
	},
	{
		title: __( 'Build with the Studio agent' ),
		subtitle: __( 'Studio Code is an AI collaborator that works on your sites with you.' ),
		points: [
			{
				title: __( 'Chat to build' ),
				body: __( 'Describe what you want. The agent designs, writes code, and edits your site.' ),
			},
			{
				title: __( 'Sites, plugins, and themes' ),
				body: __( 'Build whole sites, or scaffold a plugin or theme and take it anywhere.' ),
			},
			{
				title: __( 'Anything you can imagine' ),
				body: __( 'If WordPress can do it, you can build it in Studio.' ),
			},
		],
	},
];

/**
 * Short concept tour between the welcome screen and the build chooser: what
 * local sites are, and what the Studio agent can do. Finishing marks
 * onboarding complete and continues to the chooser.
 */
export function OnboardingTourPage() {
	const navigate = useNavigate();
	const connector = useConnector();
	// The step lives in the URL so moving between steps is a navigation and
	// picks up the onboarding flow's view transitions.
	const { step: stepSearch } = onboardingTourRoute.useSearch();
	const stepIndex = stepSearch === 'agent' ? 1 : 0;

	const step = STEPS[ stepIndex ];
	const isLastStep = stepIndex === STEPS.length - 1;

	const finishTour = useCallback( async () => {
		await connector.setOnboardingCompleted( true );
		void navigate( { to: '/onboarding/start' } );
	}, [ connector, navigate ] );

	return (
		<WizardPage
			title={ step.title }
			subtitle={ step.subtitle }
			onBack={ () => {
				if ( stepIndex === 0 ) {
					void navigate( { to: '/welcome' } );
				} else {
					void navigate( { to: '/onboarding/tour', search: {} } );
				}
			} }
			primaryAction={ {
				label: __( 'Continue' ),
				onClick: () => {
					if ( isLastStep ) {
						void finishTour();
					} else {
						void navigate( { to: '/onboarding/tour', search: { step: 'agent' } } );
					}
				},
			} }
		>
			<ul className={ `${ welcomeStyles.features } ${ styles.tourFeatures }` }>
				{ step.points.map( ( { title, body } ) => (
					<li key={ title }>
						<h3 className={ welcomeStyles.featureTitle }>
							<Icon className={ welcomeStyles.featureCheck } icon={ check } size={ 16 } />
							{ title }
						</h3>
						<p className={ welcomeStyles.featureBody }>{ body }</p>
					</li>
				) ) }
			</ul>
		</WizardPage>
	);
}

interface TourSearch {
	step?: 'agent';
}

export const onboardingTourRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/tour',
	validateSearch: ( search: Record< string, unknown > ): TourSearch => {
		if ( search.step === 'agent' ) {
			return { step: 'agent' };
		}
		return {};
	},
	component: OnboardingTourPage,
} );
