import { Link } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { settings } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { Gravatar } from '@/components/gravatar';
import * as Menu from '@/components/menu';
import { SidebarButton } from '@/components/sidebar-button';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { usePrefersColorScheme } from '@/hooks/use-prefers-color-scheme';
import { getKeyboardShortcut, getKeyboardShortcutDescriptor } from '@/lib/keyboard-shortcuts';
import styles from './style.module.css';

const WPCOM_PROFILE_URL = 'https://wordpress.com/me';
const DOCS_URL = 'https://developer.wordpress.com/docs/developer-tools/studio/';
const REPORT_ISSUE_URL = 'https://github.com/Automattic/studio/issues/new/choose';

export function UserMenu() {
	const connector = useConnector();
	const { data: user } = useAuthUser();
	const { data: preferences } = useUserPreferences();
	const login = useLogin();
	const logout = useLogout();
	const effectiveScheme = usePrefersColorScheme();
	const settingsShortcut = getKeyboardShortcutDescriptor(
		getKeyboardShortcut( 'open-app-settings' )
	);

	const savedScheme = preferences?.colorScheme;
	const themeIsDark =
		savedScheme === 'dark' || ( savedScheme !== 'light' && effectiveScheme === 'dark' );

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
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					className={ styles.settingsButton }
					icon={ settings }
					label={ __( 'Settings' ) }
					shortcut={ settingsShortcut }
					nativeButton={ false }
					render={
						<Link
							to="/settings"
							activeOptions={ { exact: true } }
							activeProps={ {
								className: clsx( styles.settingsButton, styles.settingsButtonActive ),
							} }
						/>
					}
				/>
			</div>
		</div>
	);
}
