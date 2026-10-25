import { getLocalizedLink } from '@studio/common/lib/docs-links';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { useId, useRef } from 'react';
import { useConnector } from '@/data/core';
import { useColorScheme } from '@/data/host/use-color-scheme';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { Gravatar } from '@/features/account';
import { useOffline } from '@/lib/hooks';
import { IntelligenceIcon, ShareIcon, SyncIcon } from '@/lib/icons';
import {
	AlertDialog,
	Button,
	Checkbox,
	DialogContent,
	DialogDescription,
	DialogTitle,
	Field,
	FieldLabel,
} from '@/lib/ui';
import appIcon from './app-icon.png';
import styles from './style.module.css';

/**
 * The first launch's welcome, over the empty workspace (`?welcome`): sign in or
 * continue without an account, then Add site. Continuing accepts the terms, so
 * the dialog only closes through its buttons.
 */
export function WelcomeDialog() {
	const { welcome } = useSearch( { strict: false } ) as { welcome?: true };
	const navigate = useNavigate();
	const connector = useConnector();
	const locale = useUserLocale();
	const isDark = useColorScheme() === 'dark';
	const isOffline = useOffline();
	const { data: authUser } = useAuthUser();
	const login = useLogin( { source: 'onboarding' } );
	const signup = useLogin( { signup: true, source: 'onboarding' } );
	const logout = useLogout();
	const { data: preferences } = useUserPreferences();
	const savePreferences = useSaveUserPreferences();
	const analyticsId = useId();
	const popup = useRef< HTMLDivElement >( null );
	const authError = login.error ?? signup.error;
	const waiting = login.isPending || signup.isPending;

	const finish = async () => {
		await connector.setOnboardingCompleted( true );
		void navigate( {
			to: '.',
			search: ( previous: Record< string, unknown > ) => ( {
				...previous,
				welcome: undefined,
				addSite: 'create',
			} ),
		} );
	};
	const openLegalLink = ( key: 'a8cTos' | 'a8cPrivacyPolicy' ) =>
		void connector.openExternalUrl( getLocalizedLink( locale, key ) );
	const legalLink = ( key: 'a8cTos' | 'a8cPrivacyPolicy' ) => (
		<Button
			type="button"
			variant="inline-accent"
			size="inline"
			onClick={ () => openLegalLink( key ) }
		/>
	);

	return (
		<AlertDialog open={ !! welcome }>
			<DialogContent
				ref={ popup }
				layout="confirmation"
				showCloseButton={ false }
				initialFocus={ () => popup.current }
				className={ styles.dialog }
			>
				<div className={ styles.intro }>
					<img src={ appIcon } alt="" className={ styles.appIcon } />
					<DialogTitle>{ __( 'Welcome to WordPress Studio' ) }</DialogTitle>
					<DialogDescription>
						{ authUser
							? __(
									'Build and run WordPress sites on your computer. Studio Code, publishing and preview links are ready to use.'
							  )
							: __( 'Build and run WordPress sites on your computer.' ) }
					</DialogDescription>
				</div>

				{ authUser ? (
					<div className={ styles.actions }>
						<div className={ styles.account }>
							<Gravatar email={ authUser.email } isDark={ isDark } className={ styles.avatar } />
							<span className={ styles.accountText }>
								<span className={ styles.accountName }>{ authUser.displayName }</span>
								<span className={ styles.accountHint }>
									{ __( 'Signed in with WordPress.com' ) }
								</span>
							</span>
							<Button
								variant="ghost"
								size="sm"
								loading={ logout.isPending }
								onClick={ () => logout.mutate() }
							>
								{ __( 'Log out' ) }
							</Button>
						</div>
						<Button onClick={ () => void finish() }>{ __( 'Continue' ) }</Button>
					</div>
				) : (
					<div className={ styles.actions }>
						<div className={ styles.perks }>
							<p className={ styles.perksLead }>{ __( 'With a free WordPress.com account' ) }</p>
							<ul className={ styles.perksList }>
								<li>
									<IntelligenceIcon />
									<span>
										{ createInterpolateElement( __( '<b>Studio Code</b>, with free AI credits' ), {
											b: <b />,
										} ) }
									</span>
								</li>
								<li>
									<SyncIcon />
									<span>
										{ createInterpolateElement(
											__( '<b>Publish and pull</b> with WordPress.com' ),
											{
												b: <b />,
											}
										) }
									</span>
								</li>
								<li>
									<ShareIcon />
									<span>
										{ createInterpolateElement( __( '<b>Preview links</b> to share your work' ), {
											b: <b />,
										} ) }
									</span>
								</li>
							</ul>
						</div>
						<Button
							disabled={ isOffline || signup.isPending }
							title={ isOffline ? __( "You're currently offline." ) : undefined }
							loading={ login.isPending }
							onClick={ () => login.mutate() }
						>
							{ login.isPending
								? __( 'Finish logging in in your browser' )
								: __( 'Log in with WordPress.com' ) }
						</Button>
						{ waiting ? (
							<Button
								variant="ghost"
								onClick={ () => {
									login.reset();
									signup.reset();
								} }
							>
								{ __( 'Cancel' ) }
							</Button>
						) : (
							<>
								<Button variant="outline" onClick={ () => void finish() }>
									{ __( 'Continue without an account' ) }
								</Button>
								<p className={ styles.hint }>
									{ createInterpolateElement(
										__( 'New to WordPress.com? <signup>Sign up for free</signup>' ),
										{
											signup: (
												<Button
													type="button"
													variant="inline-accent"
													size="inline"
													disabled={ isOffline }
													onClick={ () => signup.mutate() }
												/>
											),
										}
									) }
								</p>
							</>
						) }
						{ authError && (
							<p role="alert" className={ styles.error }>
								{ authError instanceof Error
									? authError.message
									: __( 'Authentication failed. Please try again.' ) }
							</p>
						) }
					</div>
				) }

				<div className={ styles.footer }>
					<Field orientation="horizontal">
						<Checkbox
							id={ analyticsId }
							checked={ preferences?.analyticsEnabled ?? true }
							onCheckedChange={ ( analyticsEnabled ) =>
								savePreferences.mutate( {
									analyticsEnabled,
									source: { surface: 'onboarding' },
								} )
							}
						/>
						<FieldLabel htmlFor={ analyticsId }>
							{ __( 'Share anonymous usage statistics' ) }
						</FieldLabel>
					</Field>
					<p className={ styles.legal }>
						{ createInterpolateElement(
							__(
								'By continuing, you agree to our <tos_link>Terms of Service</tos_link> and have read our <privacy_link>Privacy Policy</privacy_link>.'
							),
							{ tos_link: legalLink( 'a8cTos' ), privacy_link: legalLink( 'a8cPrivacyPolicy' ) }
						) }
					</p>
				</div>
			</DialogContent>
		</AlertDialog>
	);
}
