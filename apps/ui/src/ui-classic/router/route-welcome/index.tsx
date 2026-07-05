import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { check, chevronRight, Icon } from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import { useCallback, useEffect, useRef } from 'react';
import { DotGrid } from '@/components/dot-grid';
import { Gravatar } from '@/components/gravatar';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useOffline } from '@/hooks/use-offline';
import { usePrefersColorScheme } from '@/hooks/use-prefers-color-scheme';
import { getLocalizedLink } from '@/lib/docs-links';
import { EmptyBackground } from '../../components/session-view/empty-background';
import { rootRoute } from '../layout-root';
import styles from './style.module.css';

const FEATURES = [
	{
		title: __( 'Build with AI' ),
		body: __( 'Describe what you want and let AI build it with you, right on your machine.' ),
	},
	{
		title: __( 'Seamless sync' ),
		body: __( 'Go from local to live in minutes, or pull any site down to work locally.' ),
	},
	{
		title: __( 'Plugins, themes, and more' ),
		body: __( 'Develop and test safely before shipping anywhere.' ),
	},
];

/**
 * First-run welcome screen: connect a WordPress.com account or skip, then
 * continue to the concept tour (which marks onboarding complete before site
 * creation). Logging in advances automatically once the OAuth round-trip
 * lands; the flow picker offers a way back while no sites exist.
 */
export function WelcomePage() {
	const navigate = useNavigate();
	const connector = useConnector();
	const login = useLogin();
	const logout = useLogout();
	const { data: authUser } = useAuthUser();
	const isOffline = useOffline();
	const locale = useUserLocale();
	const isDark = usePrefersColorScheme() === 'dark';
	const offlineMessage = __( "You're currently offline." );

	const continueToTour = useCallback( () => {
		void navigate( { to: '/onboarding/tour' } );
	}, [ navigate ] );

	// Auto-advance only on a fresh login (signed-out → signed-in while this
	// screen is up). An already-authenticated user can revisit the welcome
	// without being bounced straight back to the tour.
	const previousAuthRef = useRef< typeof authUser >( undefined );
	useEffect( () => {
		const previous = previousAuthRef.current;
		previousAuthRef.current = authUser;
		if ( authUser && previous === null ) {
			continueToTour();
		}
	}, [ authUser, continueToTour ] );

	const openLegalLink = ( key: 'a8cTos' | 'a8cPrivacyPolicy' ) =>
		void connector.openExternalUrl( getLocalizedLink( locale, key ) );

	return (
		<div className={ styles.page }>
			{ /* Same decorative backdrop as the onboarding shell, so the
			     welcome reads as the start of that flow. */ }
			<div aria-hidden="true" className={ styles.pageDotGrid }>
				<DotGrid spacing={ 32 } crossSize={ 5 } opacity={ 0.2 } intro={ false } />
			</div>
			<div aria-hidden="true">
				<div className={ `${ styles.dragEdge } ${ styles.dragEdgeTop }` } />
				<div className={ `${ styles.dragEdge } ${ styles.dragEdgeLeft }` } />
				<div className={ `${ styles.dragEdge } ${ styles.dragEdgeBottom }` } />
			</div>

			<Button
				type="button"
				variant="minimal"
				tone="neutral"
				className={ styles.skipButton }
				onClick={ continueToTour }
			>
				<span>{ authUser ? __( 'Continue' ) : __( 'Skip' ) }</span>
				<Icon icon={ chevronRight } size={ 16 } />
			</Button>

			<div className={ styles.content }>
				<div className={ styles.logoToy }>
					<EmptyBackground logoSize={ 380 } padding={ 200 } contained={ false } />
				</div>
				{ /* Overlaps the lower part of the toy; the scrim blurs the
				     particles behind the text with a soft top fade. */ }
				<div className={ styles.contentBody }>
					<div aria-hidden="true" className={ styles.contentScrim } />
					<h1 className={ styles.title }>{ __( 'WordPress Studio' ) }</h1>
					<p className={ styles.subtitle }>
						{ __( 'Connect your WordPress.com account to unlock AI and seamless sync.' ) }
					</p>

					<ul className={ styles.features }>
						{ FEATURES.map( ( { title, body } ) => (
							<li key={ title }>
								<h3 className={ styles.featureTitle }>
									<Icon className={ styles.featureCheck } icon={ check } size={ 16 } />
									{ title }
								</h3>
								<p className={ styles.featureBody }>{ body }</p>
							</li>
						) ) }
					</ul>
				</div>
			</div>

			<p className={ styles.legal }>
				{ __( 'By continuing, you agree to our' ) }{ ' ' }
				<button
					type="button"
					className={ styles.linkButton }
					onClick={ () => openLegalLink( 'a8cTos' ) }
				>
					{ __( 'Terms of Service' ) }
				</button>{ ' ' }
				{ __( 'and have read our' ) }{ ' ' }
				<span className={ styles.noWrap }>
					<button
						type="button"
						className={ styles.linkButton }
						onClick={ () => openLegalLink( 'a8cPrivacyPolicy' ) }
					>
						{ __( 'Privacy Policy' ) }
					</button>
					.
				</span>
			</p>

			<div className={ styles.footerActions }>
				{ authUser ? (
					<>
						<span className={ styles.identity }>
							<Gravatar
								email={ authUser.email }
								isDark={ isDark }
								className={ styles.identityAvatar }
							/>
							{ authUser.displayName }
						</span>
						<Button
							type="button"
							variant="outline"
							tone="neutral"
							loading={ logout.isPending }
							onClick={ () => logout.mutate() }
						>
							{ __( 'Log out' ) }
						</Button>
					</>
				) : (
					<>
						<Button
							type="button"
							variant="minimal"
							tone="neutral"
							disabled={ isOffline }
							title={ isOffline ? offlineMessage : undefined }
							onClick={ () => void connector.authenticate( true ) }
						>
							{ __( 'Sign up' ) }
							<span aria-hidden className={ styles.arrow }>
								{ '↗' }
							</span>
						</Button>
						<Button
							type="button"
							variant="solid"
							tone="brand"
							disabled={ isOffline }
							title={ isOffline ? offlineMessage : undefined }
							loading={ login.isPending }
							onClick={ () => login.mutate() }
						>
							{ __( 'Log in to WordPress.com' ) }
							<span aria-hidden className={ styles.arrow }>
								{ '↗' }
							</span>
						</Button>
					</>
				) }
			</div>
		</div>
	);
}

export const welcomeRoute = createRoute( {
	getParentRoute: () => rootRoute,
	path: '/welcome',
	// The welcome is only for first-run: once sites exist, deep links bounce
	// back to the app. Site-less users may revisit it via the flow picker's
	// back button, even after skipping.
	beforeLoad: async ( { context } ) => {
		const sites = await context.queryClient.fetchQuery( {
			queryKey: SITES_QUERY_KEY,
			queryFn: () => context.connector.getSites(),
		} );
		if ( sites.length > 0 ) {
			throw redirect( { to: '/' } );
		}
	},
	component: WelcomePage,
} );
