import { __ } from '@wordpress/i18n';
import { Icon, wordpress } from '@wordpress/icons';
import { Button, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { Gravatar } from '@/components/gravatar';
import { SpacefastLogo } from '@/components/spacefast-logo';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import {
	useSpacefastLogin,
	useSpacefastLogout,
	useSpacefastSignedIn,
	useSpacefastTeams,
} from '@/data/queries/use-spacefast';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOffline } from '@/hooks/use-offline';
import { getLocalizedLink, REPORT_ISSUE_URL } from '@/lib/docs-links';
import styles from './style.module.css';
import type { ComponentProps, ReactNode } from 'react';

function AccountHelpActions() {
	const connector = useConnector();
	const locale = useUserLocale();

	const openLink = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	return (
		<div className={ styles.accountActions }>
			<Tooltip.Root>
				<Tooltip.Trigger
					render={
						<Button
							type="button"
							variant="minimal"
							tone="neutral"
							size="small"
							onClick={ () => openLink( getLocalizedLink( locale, 'docsStudio' ) ) }
						>
							{ __( 'Docs' ) }
						</Button>
					}
				/>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
					{ __( 'Documentation' ) }
				</Tooltip.Popup>
			</Tooltip.Root>
			<Tooltip.Root>
				<Tooltip.Trigger
					render={
						<Button
							type="button"
							variant="minimal"
							tone="neutral"
							size="small"
							onClick={ () => openLink( REPORT_ISSUE_URL ) }
						>
							{ __( 'Report an issue' ) }
						</Button>
					}
				/>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
					{ __( 'Report an issue or request a feature' ) }
				</Tooltip.Popup>
			</Tooltip.Root>
		</div>
	);
}

type AccountRowProps = {
	media: ReactNode;
	title: string;
	description: string;
	isLoggedIn: boolean;
	loginDisabled: boolean;
	isLoggingIn: boolean;
	isLoggingOut: boolean;
	onLogin: () => void;
	onLogout: () => void;
};

function AccountRow( {
	media,
	title,
	description,
	isLoggedIn,
	loginDisabled,
	isLoggingIn,
	isLoggingOut,
	onLogin,
	onLogout,
}: AccountRowProps ) {
	return (
		<div className={ styles.accountSummary }>
			<div className={ styles.accountIdentity }>
				{ media }
				<div className={ styles.accountDetails }>
					<h2>{ title }</h2>
					<p>{ description }</p>
				</div>
			</div>
			{ isLoggedIn ? (
				<Button
					type="button"
					variant="outline"
					tone="neutral"
					loading={ isLoggingOut }
					loadingAnnouncement={ __( 'Logging out' ) }
					onClick={ onLogout }
				>
					{ __( 'Log out' ) }
				</Button>
			) : (
				<Button
					type="button"
					variant="outline"
					tone="neutral"
					disabled={ loginDisabled }
					loading={ isLoggingIn }
					loadingAnnouncement={ __( 'Logging in' ) }
					onClick={ onLogin }
				>
					{ __( 'Log in' ) }
				</Button>
			) }
		</div>
	);
}

function AccountIcon( { icon }: { icon: ComponentProps< typeof Icon >[ 'icon' ] } ) {
	return (
		<span className={ clsx( styles.accountAvatar, styles.accountIcon ) } aria-hidden="true">
			<Icon icon={ icon } size={ 24 } />
		</span>
	);
}

export function AccountSection() {
	const { data: user, isLoading } = useAuthUser();
	const login = useLogin( { source: 'settings' } );
	const logout = useLogout();
	// Studio's own Spacefast sign-in, used to publish static copies of sites. Its API key
	// carries no name, so the teams it publishes to identify the account instead.
	const { data: spacefastLoggedIn, isLoading: isSpacefastLoading } = useSpacefastSignedIn();
	const { data: spacefastTeams } = useSpacefastTeams( !! spacefastLoggedIn );
	const spacefastLogin = useSpacefastLogin();
	const spacefastLogout = useSpacefastLogout();
	const themeIsDark = useColorScheme() === 'dark';
	const isOffline = useOffline();

	return (
		<section className={ styles.preferenceSectionGroup }>
			<div className={ styles.accountSectionHeader }>
				<h2 className={ clsx( styles.preferenceSectionHeading, styles.accountHeading ) }>
					{ __( 'Account' ) }
				</h2>
				<AccountHelpActions />
			</div>
			<div className={ styles.accountRows }>
				<AccountRow
					media={
						user ? (
							<Gravatar
								email={ user.email }
								isDark={ themeIsDark }
								className={ styles.accountAvatar }
							/>
						) : (
							<AccountIcon icon={ wordpress } />
						)
					}
					title={ user ? user.displayName : __( 'WordPress.com' ) }
					description={
						user
							? user.email
							: __( 'Log in to use AI features and synchronize with live and preview sites.' )
					}
					isLoggedIn={ !! user }
					loginDisabled={ isLoading || isOffline }
					isLoggingIn={ login.isPending }
					isLoggingOut={ logout.isPending }
					onLogin={ () => login.mutate() }
					onLogout={ () => logout.mutate() }
				/>
				<AccountRow
					media={ <SpacefastLogo className={ clsx( styles.accountAvatar, styles.accountLogo ) } /> }
					title={ __( 'Spacefast' ) }
					description={
						spacefastLoggedIn
							? spacefastTeams?.map( ( team ) => team.name ).join( ', ' ) ?? ''
							: __( 'Log in to publish static copies of your sites.' )
					}
					isLoggedIn={ !! spacefastLoggedIn }
					loginDisabled={ isSpacefastLoading || isOffline }
					isLoggingIn={ spacefastLogin.isPending }
					isLoggingOut={ spacefastLogout.isPending }
					onLogin={ () => spacefastLogin.mutate() }
					onLogout={ () => spacefastLogout.mutate() }
				/>
			</div>
		</section>
	);
}
