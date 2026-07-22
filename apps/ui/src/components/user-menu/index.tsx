import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { cog } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { useTourAnchor } from '@/components/coachmarks/anchor-registry';
import { Gravatar } from '@/components/gravatar';
import * as Menu from '@/components/menu';
import { SidebarButton } from '@/components/sidebar-button';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOffline } from '@/hooks/use-offline';
import { getLocalizedLink, REPORT_ISSUE_URL } from '@/lib/docs-links';
import { drawerIcon } from '@/lib/icons';
import styles from './style.module.css';

const WPCOM_PROFILE_URL = 'https://wordpress.com/me';

type Props = {
	onToggleSidebar?: () => void;
};

export function UserMenu( { onToggleSidebar }: Props ) {
	const connector = useConnector();
	const { data: user } = useAuthUser();
	const login = useLogin();
	const logout = useLogout();
	const navigate = useNavigate();
	const settingsAnchorRef = useTourAnchor( 'sidebar-user-menu' );
	const isOffline = useOffline();
	const locale = useUserLocale();

	const themeIsDark = useColorScheme() === 'dark';

	const openLink = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	return (
		<div className={ styles.root }>
			<div className={ styles.row } ref={ settingsAnchorRef }>
				{ user ? (
					<Menu.Root modal={ false }>
						<Menu.Trigger
							render={
								<SidebarButton className={ styles.userTrigger }>
									<Gravatar email={ user.email } isDark={ themeIsDark } />
									<span className={ styles.userName }>{ user.displayName }</span>
								</SidebarButton>
							}
						/>
						<Menu.Popup side="top" align="start" className={ styles.popup }>
							<div className={ styles.email } title={ user.email }>
								{ user.email }
							</div>
							<Menu.Item onClick={ () => void navigate( { to: '/settings' } ) }>
								{ __( 'Settings' ) }
							</Menu.Item>
							<Menu.Separator />
							<Menu.Item onClick={ () => openLink( WPCOM_PROFILE_URL ) }>
								{ __( 'Edit WordPress.com profile' ) }
							</Menu.Item>
							<Menu.Item
								disabled={ isOffline }
								onClick={ () => openLink( getLocalizedLink( locale, 'docsStudio' ) ) }
							>
								{ __( 'Documentation' ) }
							</Menu.Item>
							<Menu.Item disabled={ isOffline } onClick={ () => openLink( REPORT_ISSUE_URL ) }>
								{ __( 'Report an issue' ) }
							</Menu.Item>
							<Menu.Separator />
							<Menu.Item onClick={ () => logout.mutate() }>{ __( 'Log out' ) }</Menu.Item>
						</Menu.Popup>
					</Menu.Root>
				) : (
					<SidebarButton
						className={ styles.loginButton }
						disabled={ isOffline }
						onClick={ () => login.mutate() }
					>
						{ __( 'Log in with WordPress.com' ) }
					</SidebarButton>
				) }
				{ ! user ? (
					// Logged in, Settings lives in the user menu; logged out
					// there is no menu, so keep the page reachable here.
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ cog }
						label={ __( 'Settings' ) }
						className={ styles.settingsButton }
						onClick={ () => void navigate( { to: '/settings' } ) }
					/>
				) : null }
				{ onToggleSidebar ? (
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						className={ styles.sidebarToggle }
						icon={ drawerIcon }
						label={ __( 'Hide sidebar' ) }
						onClick={ onToggleSidebar }
					/>
				) : null }
			</div>
		</div>
	);
}
