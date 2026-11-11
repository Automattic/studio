import { getLocalizedLink } from '@studio/common/lib/docs-links';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAnalyticsExposure } from '@/data/account-analytics';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useSites } from '@/data/queries/use-sites';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { AccountPromptDialog } from '@/features/account';
import { Button, Checkbox, Field, FieldLabel } from '@/lib/ui';
import styles from './style.module.css';
import type { OnboardingAnalytics } from '@studio/common/lib/auth-tracks';

export function WelcomeDialog() {
	const { welcome } = useSearch( { strict: false } ) as { welcome?: true };
	return welcome ? <WelcomeFlow /> : null;
}

function WelcomeFlow() {
	const navigate = useNavigate();
	const connector = useConnector();
	const locale = useUserLocale();
	const { data: authUser, isPending: authLoading } = useAuthUser();
	const { data: sites } = useSites();
	const { data: preferences } = useUserPreferences();
	const savePreferences = useSaveUserPreferences();
	const [ authenticationStarted, setAuthenticationStarted ] = useState( false );
	const [ finishing, setFinishing ] = useState( false );
	const [ finishError, setFinishError ] = useState( false );
	const finishingRef = useRef( false );
	const analyticsId = useId();
	const popup = useRef< HTMLDivElement | null >( null );
	const [ journeyId ] = useState( () => crypto.randomUUID() );
	const exposure = useAnalyticsExposure( TRACKS_EVENTS.ONBOARDING_VIEWED, {
		step: 'account',
		journey_id: journeyId,
	} );
	const setPopup = useCallback(
		( node: HTMLDivElement | null ) => {
			popup.current = node;
			exposure( node );
		},
		[ exposure ]
	);

	const finish = useCallback(
		async ( completionPath: OnboardingAnalytics[ 'completion_path' ] = 'dismissed' ) => {
			if ( finishingRef.current ) return;
			finishingRef.current = true;
			setFinishing( true );
			setFinishError( false );
			try {
				await connector.setOnboardingCompleted( true, {
					completion_path: completionPath,
					journey_id: journeyId,
				} );
				await navigate( {
					to: '.',
					search: ( previous: Record< string, unknown > ) => ( {
						...previous,
						welcome: undefined,
						addSite: sites?.length ? undefined : 'create',
					} ),
				} );
			} catch {
				finishingRef.current = false;
				setFinishing( false );
				setFinishError( true );
			}
		},
		[ connector, navigate, sites, journeyId ]
	);

	useEffect( () => {
		if ( authenticationStarted && authUser && ! finishError )
			void finish( 'authenticated_continue' );
	}, [ authenticationStarted, authUser, finish, finishError ] );

	const legalLink = ( key: 'a8cTos' | 'a8cPrivacyPolicy' ) => (
		<Button
			type="button"
			variant="inline-text"
			className={ styles.legalLink }
			size="inline"
			onClick={ () => void connector.openExternalUrl( getLocalizedLink( locale, key ) ) }
		/>
	);

	return (
		<AccountPromptDialog
			open
			ref={ setPopup }
			initialFocus={ () => popup.current }
			onOpenChange={ ( open ) => {
				if ( ! open && ! savePreferences.isPending ) void finish();
			} }
			title={ __( 'Welcome to WordPress Studio' ) }
			description={ __(
				'Create a free WordPress.com account to build with the agent, share previews, and publish.'
			) }
			source="onboarding"
			analytics={ { placement: 'welcome', intent: 'onboarding', journey_id: journeyId } }
			onSkip={ () => void finish( 'continue_without_account' ) }
			onCreateAccount={ () => setAuthenticationStarted( true ) }
			onContinue={ authUser ? () => void finish( 'authenticated_continue' ) : undefined }
			busy={ finishing || authLoading }
			disabled={ savePreferences.isPending }
			footer={
				<>
					<div className={ styles.privacy }>
						<Field orientation="horizontal" className={ styles.analytics }>
							<Checkbox
								id={ analyticsId }
								checked={ preferences?.analyticsEnabled ?? true }
								disabled={ savePreferences.isPending }
								onCheckedChange={ ( analyticsEnabled ) =>
									savePreferences.mutate( {
										analyticsEnabled,
										source: { surface: 'onboarding' },
									} )
								}
							/>
							<FieldLabel htmlFor={ analyticsId } className={ styles.analyticsLabel }>
								{ __( 'Share anonymous usage statistics' ) }
							</FieldLabel>
						</Field>
						{ savePreferences.isError && (
							<p role="alert" className={ styles.error }>
								{ __( 'Your preference could not be saved. Please try again.' ) }
							</p>
						) }
						<p className={ styles.legal }>
							{ createInterpolateElement(
								__(
									'By continuing, you agree to our <tos_link>Terms of Service</tos_link> and have read our <privacy_link>Privacy Policy</privacy_link>.'
								),
								{
									tos_link: legalLink( 'a8cTos' ),
									privacy_link: legalLink( 'a8cPrivacyPolicy' ),
								}
							) }
						</p>
					</div>
					{ finishError && (
						<p role="alert" className={ styles.error }>
							{ __( 'Setup could not be saved. Please try again.' ) }
						</p>
					) }
				</>
			}
		/>
	);
}
