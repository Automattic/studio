import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { CheckboxControl } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { chevronRight } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useCallback, useEffect, useRef } from 'react';
import { AuthActions } from '@/components/auth-actions';
import { DotGrid } from '@/components/dot-grid';
import { FeatureList } from '@/components/feature-list';
import { Gravatar } from '@/components/gravatar';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogout } from '@/data/queries/use-auth-user';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { usePrefersColorScheme } from '@/hooks/use-prefers-color-scheme';
import { getLocalizedLink } from '@/lib/docs-links';
import { EmptyBackground } from '../../components/session-view/empty-background';
import { rootRoute } from '../layout-root';
import styles from './style.module.css';

export function WelcomePage() {
	const navigate = useNavigate();
	const connector = useConnector();
	const logout = useLogout();
	const { data: authUser } = useAuthUser();
	const locale = useUserLocale();
	const { data: preferences } = useUserPreferences();
	const saveUserPreferences = useSaveUserPreferences();
	const isDark = usePrefersColorScheme() === 'dark';

	// The welcome screen owns the account story: these are the features a
	// WordPress.com login unlocks.
	const features = [
		{
			title: __( 'Studio Code' ),
			body: __( 'An AI collaborator that designs, writes code, and builds sites with you.' ),
		},
		{
			title: __( 'Sync with live sites' ),
			body: __( 'Push and pull changes to WordPress.com or Pressable anytime.' ),
		},
		{
			title: __( 'Preview links' ),
			body: __( 'Share a temporary copy of any site with anyone.' ),
		},
	];

	// The tour marks onboarding complete when it finishes; the welcome only
	// hands off to it.
	const continueToTour = useCallback( () => {
		void navigate( { to: '/onboarding/tour' } );
	}, [ navigate ] );

	// Auto-advance only on a fresh login (signed-out → signed-in while this
	// screen is up). An already-authenticated user can revisit the welcome
	// without being bounced straight onward.
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

			<div className={ styles.contentArea }>
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
							{ __( 'Your local studio for building WordPress sites, plugins, and themes.' ) }
						</p>

						<FeatureList features={ features } />
					</div>
				</div>

				<div className={ styles.analyticsPreference }>
					<CheckboxControl
						__nextHasNoMarginBottom
						label={ __( 'Help improve Studio by sharing anonymous usage statistics' ) }
						checked={ preferences?.analyticsEnabled ?? true }
						onChange={ ( analyticsEnabled ) =>
							saveUserPreferences.mutate( {
								analyticsEnabled,
								source: { surface: 'onboarding' },
							} )
						}
					/>
				</div>
			</div>

			<div className={ styles.footer }>
				<p className={ styles.legal }>
					{ createInterpolateElement(
						__(
							'By continuing, you agree to our <tos_link>Terms of Service</tos_link> and have read our <privacy_link>Privacy Policy</privacy_link>.'
						),
						{
							tos_link: (
								<button
									type="button"
									className={ styles.linkButton }
									onClick={ () => openLegalLink( 'a8cTos' ) }
								/>
							),
							privacy_link: (
								<button
									type="button"
									className={ styles.linkButton }
									onClick={ () => openLegalLink( 'a8cPrivacyPolicy' ) }
								/>
							),
						}
					) }
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
						<AuthActions />
					) }
				</div>
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
