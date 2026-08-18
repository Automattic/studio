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
import { UsageSummary } from './usage-panel';

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
	const { data: user, isLoading } = useAuthUser();
	const login = useLogin( { source: 'settings' } );
	const logout = useLogout();
	const themeIsDark = useColorScheme() === 'dark';
	const isOffline = useOffline();

	return (
		<aside className={ styles.accountAside }>
			<section className={ styles.accountSection }>
				<h2 className={ styles.cardTitle }>{ __( 'Account' ) }</h2>
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
					<Button
						type="button"
						variant="outline"
						tone="neutral"
						size="small"
						loading={ logout.isPending }
						loadingAnnouncement={ __( 'Logging out' ) }
						onClick={ () => logout.mutate() }
					>
						{ __( 'Log out' ) }
					</Button>
				) : (
					<Button
						type="button"
						variant="outline"
						tone="neutral"
						size="small"
						disabled={ isLoading || isOffline }
						loading={ login.isPending }
						loadingAnnouncement={ __( 'Logging in' ) }
						onClick={ () => login.mutate() }
					>
						{ __( 'Log in' ) }
					</Button>
				) }
			</section>
			<UsageSummary userId={ user?.id } unframed />
			<section className={ clsx( styles.accountSection, styles.accountHelp ) }>
				<h2 className={ styles.cardTitle }>{ __( 'Help' ) }</h2>
				<AccountHelpActions />
			</section>
		</aside>
	);
}
