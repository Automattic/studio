import { createRoute, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { check, Icon } from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import { useCallback } from 'react';
import { SiteListIllustration } from '@/components/onboarding-illustrations';
import { AgentPixelField } from '@/components/onboarding-illustrations/agent-pixel-field';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useOffline } from '@/hooks/use-offline';
import { WizardPage } from '../../components/wizard-page';
import { onboardingLayoutRoute } from '../layout-onboarding';
// The checkmark feature-list styles are shared with the welcome screen so
// the two can't drift apart visually.
import welcomeStyles from '../route-welcome/style.module.css';
import styles from './style.module.css';

const STEPS = [
	{
		title: __( 'Sites run right on your machine' ),
		subtitle: __(
			'Every Studio site is a real WordPress install that lives locally, PHP and database included.'
		),
		illustration: (
			<div className={ styles.tourIllustration }>
				<SiteListIllustration />
			</div>
		),
		points: [
			{
				title: __( 'Zero setup' ),
				body: __(
					'No servers to set up, no accounts to create. A fresh site is ready in seconds.'
				),
			},
			{
				title: __( 'Works offline' ),
				body: __( 'Your sites don’t need the internet. Build on a plane, at a café, anywhere.' ),
			},
			{
				title: __( 'Safe to break' ),
				body: __( 'Experiment freely. If something breaks, just start over. Nothing is at stake.' ),
			},
		],
	},
	{
		title: __( 'Build with Studio Code' ),
		subtitle: __( 'Studio Code is an AI collaborator that works on your sites with you.' ),
		illustration: (
			<div className={ styles.tourPixelField }>
				<AgentPixelField />
			</div>
		),
		points: [
			{
				title: __( 'Chat to build' ),
				body: __(
					'Describe what you want. Studio Code designs, writes code, and edits your site.'
				),
			},
			{
				title: __( 'Sites, plugins, and themes' ),
				body: __( 'Build whole sites, or scaffold a plugin or theme and take it anywhere.' ),
			},
			{
				title: __( 'Anything you can imagine' ),
				body: __( 'If WordPress can do it, you can build it in your Studio.' ),
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
	// Users who skipped login on the welcome screen arrive at the Studio Code
	// step signed out; since the agent needs a WordPress.com account, this
	// step doubles as the second (and last) login prompt in the flow.
	const { data: authUser } = useAuthUser();
	const login = useLogin();
	const isOffline = useOffline();
	const offlineMessage = __( "You're currently offline." );
	// The step lives in the URL so moving between steps is a navigation and
	// picks up the onboarding flow's view transitions.
	const { step: stepSearch } = onboardingTourRoute.useSearch();
	const stepIndex = stepSearch === 'agent' ? 1 : 0;

	const step = STEPS[ stepIndex ];
	const isLastStep = stepIndex === STEPS.length - 1;
	// The last step doubles as the login prompt; when the user is signed out the
	// primary action skips it rather than simply continuing.
	const isLoginStep = isLastStep && ! authUser;

	const finishTour = useCallback( async () => {
		await connector.setOnboardingCompleted( true );
		void navigate( { to: '/onboarding' } );
	}, [ connector, navigate ] );

	return (
		<WizardPage
			title={ step.title }
			subtitle={ step.subtitle }
			illustration={ step.illustration }
			onBack={ () => {
				if ( stepIndex === 0 ) {
					void navigate( { to: '/welcome' } );
				} else {
					void navigate( { to: '/onboarding/tour', search: {} } );
				}
			} }
			primaryAction={ {
				label: isLoginStep ? __( 'Skip log in' ) : __( 'Continue' ),
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
			{ isLastStep && ! authUser && (
				<div className={ styles.tourAuth }>
					<p className={ styles.tourAuthText }>
						{ __( 'AI features require a free WordPress.com account.' ) }
					</p>
					{ /* Same auth pair as the welcome screen. */ }
					<div className={ styles.tourAuthButtons }>
						<Button
							type="button"
							variant="minimal"
							tone="neutral"
							disabled={ isOffline }
							title={ isOffline ? offlineMessage : undefined }
							onClick={ () => void connector.authenticate( true ) }
						>
							{ __( 'Sign up' ) }
							<span aria-hidden className={ welcomeStyles.arrow }>
								{ '↗' }
							</span>
						</Button>
						<Button
							type="button"
							variant="outline"
							tone="brand"
							disabled={ isOffline }
							title={ isOffline ? offlineMessage : undefined }
							loading={ login.isPending }
							onClick={ () => login.mutate() }
						>
							{ __( 'Log in with WordPress.com' ) }
							<span aria-hidden className={ welcomeStyles.arrow }>
								{ '↗' }
							</span>
						</Button>
					</div>
				</div>
			) }
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
