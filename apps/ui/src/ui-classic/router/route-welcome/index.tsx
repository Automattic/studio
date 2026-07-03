import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { check, Icon } from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import { useCallback, useEffect } from 'react';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useOffline } from '@/hooks/use-offline';
import { getLocalizedLink } from '@/lib/docs-links';
import { EmptyBackground } from '../../components/session-view/empty-background';
import { rootRoute } from '../layout-root';
import styles from './style.module.css';

const FEATURES = [
	{
		title: __( 'Build with AI' ),
		body: __( 'Spin up sites and build anything you can imagine, quickly.' ),
	},
	{
		title: __( 'Seamless sync' ),
		body: __( 'Go from local to live in minutes, or pull any site down to work locally.' ),
	},
	{
		title: __( 'Plugins, themes, and more' ),
		body: __( "The sky's the limit. Use WordPress to build anything you can dream of." ),
	},
];

/**
 * First-run welcome screen: connect a WordPress.com account or skip, then
 * continue to site creation. Logging in completes the welcome automatically
 * once the OAuth round-trip lands; the flow picker offers a way back while
 * no sites exist.
 */
export function WelcomePage() {
	const navigate = useNavigate();
	const connector = useConnector();
	const login = useLogin();
	const { data: authUser } = useAuthUser();
	const isOffline = useOffline();
	const locale = useUserLocale();
	const offlineMessage = __( "You're currently offline." );

	const completeWelcome = useCallback( async () => {
		await connector.setOnboardingCompleted( true );
		void navigate( { to: '/onboarding' } );
	}, [ connector, navigate ] );

	useEffect( () => {
		if ( authUser ) {
			void completeWelcome();
		}
	}, [ authUser, completeWelcome ] );

	const openLegalLink = ( key: 'a8cTos' | 'a8cPrivacyPolicy' ) =>
		void connector.openExternalUrl( getLocalizedLink( locale, key ) );

	return (
		<div className={ styles.page }>
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
				onClick={ () => void completeWelcome() }
			>
				{ __( 'Skip' ) }
				<span aria-hidden className={ styles.arrow }>
					{ '→' }
				</span>
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
