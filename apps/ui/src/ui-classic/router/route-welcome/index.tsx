import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { CheckboxControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useCallback, useEffect, useRef } from 'react';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { rootRoute } from '../layout-root';
import styles from './style.module.css';

function WelcomePage() {
	const connector = useConnector();
	const navigate = useNavigate();
	const { data: authUser } = useAuthUser();
	const login = useLogin();
	const signup = useLogin( { signup: true } );
	const { data: preferences } = useUserPreferences();
	const saveUserPreferences = useSaveUserPreferences();

	const continueToOnboarding = useCallback( async () => {
		await connector.setOnboardingCompleted( true );
		void navigate( { to: '/onboarding' } );
	}, [ connector, navigate ] );

	// Auto-advance on a fresh login (signed-out → signed-in while this screen
	// is up). An already-authenticated user revisiting the welcome screen
	// (e.g. via browser back) won't be bounced.
	const previousAuthRef = useRef< typeof authUser >( undefined );
	useEffect( () => {
		const previous = previousAuthRef.current;
		previousAuthRef.current = authUser;
		if ( authUser && previous === null ) {
			void continueToOnboarding();
		}
	}, [ authUser, continueToOnboarding ] );

	return (
		<div className={ styles.root }>
			<h1 className={ styles.heading }>{ __( 'Welcome to Studio' ) }</h1>
			<p className={ styles.subtitle }>
				{ __( 'Log in with a free WordPress.com account to unlock everything Studio offers.' ) }
			</p>
			<ul className={ styles.features }>
				<li>{ __( 'Chat with a WordPress expert that builds and edits your site' ) }</li>
				<li>{ __( 'Share your work instantly with preview links' ) }</li>
				<li>{ __( 'Publish to a live WordPress.com site when ready' ) }</li>
			</ul>
			<div className={ styles.actions }>
				<Button
					type="button"
					variant="solid"
					tone="brand"
					loading={ login.isPending }
					onClick={ () => login.mutate() }
				>
					{ __( 'Log in with WordPress.com' ) }
				</Button>
				<Button
					type="button"
					variant="outline"
					tone="neutral"
					loading={ signup.isPending }
					onClick={ () => signup.mutate() }
				>
					{ __( 'Sign up' ) }
				</Button>
			</div>
			<Button
				type="button"
				variant="minimal"
				tone="neutral"
				className={ styles.skip }
				onClick={ () => void continueToOnboarding() }
			>
				{ __( 'Skip for now' ) }
			</Button>
			<div className={ styles.footer }>
				<CheckboxControl
					__nextHasNoMarginBottom
					label={ __( 'Help improve Studio by sharing anonymous usage statistics' ) }
					checked={ preferences?.analyticsEnabled ?? true }
					onChange={ ( analyticsEnabled ) => saveUserPreferences.mutate( { analyticsEnabled } ) }
				/>
			</div>
		</div>
	);
}

export const welcomeRoute = createRoute( {
	getParentRoute: () => rootRoute,
	path: '/welcome',
	component: WelcomePage,
	beforeLoad: async ( { context } ) => {
		const sites = await context.queryClient.fetchQuery( {
			queryKey: SITES_QUERY_KEY,
			queryFn: () => context.connector.getSites(),
		} );
		if ( sites.length > 0 ) {
			throw redirect( { to: '/' } );
		}
	},
} );
