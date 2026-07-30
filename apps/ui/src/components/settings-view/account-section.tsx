import { __ } from '@wordpress/i18n';
import { Button, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { Gravatar } from '@/components/gravatar';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOffline } from '@/hooks/use-offline';
import { getLocalizedLink, REPORT_ISSUE_URL } from '@/lib/docs-links';
import styles from './style.module.css';

const WPCOM_PROFILE_URL = 'https://wordpress.com/me';

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

export function AccountSection() {
	const connector = useConnector();
	const { data: user, isLoading } = useAuthUser();
	const login = useLogin();
	const logout = useLogout();
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
			<div className={ styles.accountSummary }>
				<div className={ styles.accountIdentity }>
					{ user ? (
						<Gravatar
							email={ user.email }
							isDark={ themeIsDark }
							className={ styles.accountAvatar }
						/>
					) : null }
					<div className={ styles.accountDetails }>
						<h2>{ user ? user.displayName : __( 'WordPress.com account' ) }</h2>
						<p>
							{ user
								? user.email
								: __( 'Log in to use AI features and synchronize with live and preview sites.' ) }
						</p>
					</div>
				</div>
				{ user ? (
					<div className={ styles.accountButtons }>
						<Button
							type="button"
							variant="minimal"
							tone="neutral"
							disabled={ isOffline }
							onClick={ () => void connector.openExternalUrl( WPCOM_PROFILE_URL ) }
						>
							{ __( 'Edit WordPress.com profile' ) }
						</Button>
						<Button
							type="button"
							variant="outline"
							tone="neutral"
							loading={ logout.isPending }
							loadingAnnouncement={ __( 'Logging out' ) }
							onClick={ () => logout.mutate() }
						>
							{ __( 'Log out' ) }
						</Button>
					</div>
				) : (
					<Button
						type="button"
						variant="outline"
						tone="neutral"
						disabled={ isLoading || isOffline }
						loading={ login.isPending }
						loadingAnnouncement={ __( 'Logging in' ) }
						onClick={ () => login.mutate() }
					>
						{ __( 'Log in' ) }
					</Button>
				) }
			</div>
		</section>
	);
}
