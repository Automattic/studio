import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { cog } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { Gravatar } from '@/components/gravatar';
import * as Menu from '@/components/menu';
import { SidebarButton } from '@/components/sidebar-button';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { drawerIcon } from '@/lib/icons';
import styles from './style.module.css';

const WPCOM_PROFILE_URL = 'https://wordpress.com/me';
const DOCS_URL = 'https://developer.wordpress.com/docs/developer-tools/studio/';
const REPORT_ISSUE_URL = 'https://github.com/Automattic/studio/issues/new/choose';

type Props = {
	onToggleSidebar?: () => void;
};

export function UserMenu( { onToggleSidebar }: Props ) {
	const connector = useConnector();
	const { data: user } = useAuthUser();
	const login = useLogin();
	const logout = useLogout();
	const navigate = useNavigate();

	const themeIsDark = useColorScheme() === 'dark';

	const openLink = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	return (
		<div className={ styles.root }>
			<div className={ styles.row }>
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
							<Menu.Item onClick={ () => openLink( DOCS_URL ) }>
								{ __( 'Documentation' ) }
							</Menu.Item>
							<Menu.Item onClick={ () => openLink( REPORT_ISSUE_URL ) }>
								{ __( 'Report an issue' ) }
							</Menu.Item>
							<Menu.Separator />
							<Menu.Item onClick={ () => logout.mutate() }>{ __( 'Log out' ) }</Menu.Item>
						</Menu.Popup>
					</Menu.Root>
				) : (
					<SidebarButton className={ styles.loginButton } onClick={ () => login.mutate() }>
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
