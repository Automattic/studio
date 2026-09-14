import { createRoute, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { chevronLeft } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback } from 'react';
import { AuthActions } from '@/components/auth-actions';
import { FeatureList } from '@/components/feature-list';
import { OnboardingFooter } from '@/components/onboarding-footer';
import { SiteListIllustration } from '@/components/onboarding-illustrations';
import { AgentPixelField } from '@/components/onboarding-illustrations/agent-pixel-field';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { onboardingLayoutRoute } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
import styles from './style.module.css';

function useSteps() {
	return [
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
					body: __(
						'Experiment freely. If something breaks, just start over. Nothing is at stake.'
					),
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
}

export function OnboardingTourPage() {
	const navigate = useNavigate();
	const connector = useConnector();
	// Users who skipped login on the welcome screen arrive at the Studio Code
	// step signed out; since the agent needs a WordPress.com account, this
	// step doubles as the second (and last) login prompt in the flow.
	const { data: authUser } = useAuthUser();
	// The step lives in the URL so moving between steps is a navigation and
	// picks up the onboarding flow's view transitions.
	const { step: stepSearch } = onboardingTourRoute.useSearch();
	const steps = useSteps();
	const stepIndex = stepSearch === 'agent' ? 1 : 0;

	const step = steps[ stepIndex ];
	const isLastStep = stepIndex === steps.length - 1;
	// The last step doubles as the login prompt; when the user is signed out the
	// primary action skips it rather than simply continuing.
	const isLoginStep = isLastStep && ! authUser;

	const finishTour = useCallback( async () => {
		await connector.setOnboardingCompleted( true );
		void navigate( { to: '/onboarding' } );
	}, [ connector, navigate ] );

	return (
		<div className={ clsx( sharedStyles.page, styles.tourPage ) }>
			{ step.illustration }
			<h1 className={ sharedStyles.title }>{ step.title }</h1>
			<p className={ sharedStyles.subtitle }>{ step.subtitle }</p>
			<FeatureList features={ step.points } className={ styles.tourFeatures } />
			{ isLoginStep && (
				<div className={ styles.tourAuth }>
					<p className={ styles.tourAuthText }>
						{ __( 'AI features require a free WordPress.com account.' ) }
					</p>
					<AuthActions source="onboarding" />
				</div>
			) }
			<OnboardingFooter>
				<Button
					type="button"
					variant="minimal"
					tone="neutral"
					onClick={ () =>
						void navigate(
							stepIndex === 0 ? { to: '/welcome' } : { to: '/onboarding/tour', search: {} }
						)
					}
				>
					<Icon icon={ chevronLeft } size={ 16 } />
					<span>{ __( 'Back' ) }</span>
				</Button>
				<Button
					type="button"
					variant="solid"
					tone="brand"
					onClick={ () => {
						if ( isLastStep ) {
							void finishTour();
						} else {
							void navigate( { to: '/onboarding/tour', search: { step: 'agent' } } );
						}
					} }
				>
					{ isLoginStep ? __( 'Skip log in' ) : __( 'Continue' ) }
				</Button>
			</OnboardingFooter>
		</div>
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
