import { __ } from '@wordpress/i18n';
import { caution, Icon, page } from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import { Gravatar } from '@/components/gravatar';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getLocalizedLink, REPORT_ISSUE_URL } from '@/lib/docs-links';
import styles from './style.module.css';
import { AiCreditsSection, PreviewUsageSection } from './usage-panel';

function AccountHelpLinks() {
	const connector = useConnector();
	const locale = useUserLocale();

	const openLink = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	return (
		<div className={ styles.helpLinks }>
			<button
				type="button"
				className={ styles.helpLink }
				aria-label={ __( 'Documentation' ) }
				onClick={ () => openLink( getLocalizedLink( locale, 'docsStudio' ) ) }
			>
				<Icon icon={ page } size={ 20 } className={ styles.helpLinkIcon } />
				<span
					className={ clsx( styles.helpLinkLabel, styles.helpLinkLabelFull ) }
					aria-hidden="true"
				>
					{ __( 'Documentation' ) }
				</span>
				<span
					className={ clsx( styles.helpLinkLabel, styles.helpLinkLabelShort ) }
					aria-hidden="true"
				>
					{ __( 'Docs' ) }
				</span>
			</button>
			<button
				type="button"
				className={ styles.helpLink }
				onClick={ () => openLink( REPORT_ISSUE_URL ) }
			>
				<Icon icon={ caution } size={ 20 } className={ styles.helpLinkIcon } />
				<span className={ styles.helpLinkLabel }>{ __( 'Report an issue' ) }</span>
			</button>
		</div>
	);
}

export function AccountSection() {
	const { data: user, isLoading } = useAuthUser();
	const login = useLogin();
	const logout = useLogout();
	const themeIsDark = useColorScheme() === 'dark';

	return (
		<div className={ clsx( styles.accountAside, user && styles.accountAsideGrid ) }>
			{ user ? (
				<>
					<section className={ clsx( styles.asideSection, styles.accountBlock ) }>
						<h2 className={ clsx( styles.asideHeading, styles.visuallyHidden ) }>
							{ __( 'Account' ) }
						</h2>
						<div className={ styles.accountIdentity }>
							<Gravatar
								email={ user.email }
								isDark={ themeIsDark }
								className={ styles.accountAvatar }
							/>
							<div className={ styles.accountDetails }>
								<span className={ styles.accountName }>{ user.displayName }</span>
								<p className={ styles.accountEmail }>{ user.email }</p>
							</div>
						</div>
					</section>

					<div className={ styles.usageGroup }>
						<AiCreditsSection />
						<PreviewUsageSection userId={ user.id } />
					</div>
				</>
			) : (
				<section className={ styles.asideSection }>
					<h2 className={ styles.asideHeading }>{ __( 'Let Studio code it for you' ) }</h2>
					<p className={ styles.signinCopy }>
						{ __(
							'An AI powered WordPress expert that can build a site, theme, or plugin, and help you share and publish.'
						) }
					</p>
					<Button
						type="button"
						className={ styles.signinButton }
						variant="solid"
						tone="neutral"
						size="small"
						disabled={ isLoading }
						loading={ login.isPending }
						loadingAnnouncement={ __( 'Logging in' ) }
						onClick={ () => login.mutate() }
					>
						{ __( 'Log in with WordPress.com' ) }
					</Button>
				</section>
			) }

			{ user ? (
				<Button
					type="button"
					className={ styles.logoutButton }
					variant="solid"
					size="small"
					loading={ logout.isPending }
					loadingAnnouncement={ __( 'Logging out' ) }
					onClick={ () => logout.mutate() }
				>
					{ __( 'Log out' ) }
				</Button>
			) : null }

			<section className={ clsx( styles.asideSection, styles.accountHelp ) }>
				<h2 className={ styles.asideHeading }>{ __( 'Help' ) }</h2>
				<AccountHelpLinks />
			</section>
		</div>
	);
}
