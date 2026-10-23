import { getLocalizedLink } from '@studio/common/lib/docs-links';
import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useMediaQuery } from '@wordpress/compose';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { chevronRight, Icon } from '@wordpress/icons';
import { useCallback, useEffect, useId, useRef } from 'react';
import { AuthActions } from '@/components/auth-actions';
import { DotGrid } from '@/components/dot-grid';
import { FeatureList } from '@/components/feature-list';
import { Gravatar } from '@/components/gravatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogout } from '@/data/queries/use-auth-user';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { EmptyBackground } from '../../components/session-view/empty-background';
import { rootRoute } from '../layout-root';
import styles from './style.module.css';

function WelcomePage() {
	const navigate = useNavigate();
	const connector = useConnector();
	const logout = useLogout();
	const { data: authUser } = useAuthUser();
	const locale = useUserLocale();
	const { data: preferences } = useUserPreferences();
	const saveUserPreferences = useSaveUserPreferences();
	const analyticsId = useId();
	const isDark = useMediaQuery( '(prefers-color-scheme: dark)' );

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
				variant="ghost"
				className={ styles.skipButton }
				onClick={ continueToTour }
			>
				{ authUser ? __( 'Continue' ) : __( 'Skip' ) }
				<Icon icon={ chevronRight } data-icon="inline-end" />
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

				<Field orientation="horizontal" className={ styles.analyticsPreference }>
					<Checkbox
						id={ analyticsId }
						checked={ preferences?.analyticsEnabled ?? true }
						onCheckedChange={ ( analyticsEnabled ) =>
							saveUserPreferences.mutate( {
								analyticsEnabled,
								source: { surface: 'onboarding' },
							} )
						}
					/>
					<FieldLabel htmlFor={ analyticsId } tone="muted">
						{ __( 'Help improve Studio by sharing anonymous usage statistics' ) }
					</FieldLabel>
				</Field>
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
								loading={ logout.isPending }
								onClick={ () => logout.mutate() }
							>
								{ __( 'Log out' ) }
							</Button>
						</>
					) : (
						<AuthActions source="onboarding" />
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
