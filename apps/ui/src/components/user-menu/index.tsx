import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { cog } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { Gravatar } from '@/components/gravatar';
import * as Menu from '@/components/menu';
import { SidebarButton } from '@/components/sidebar-button';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOffline } from '@/hooks/use-offline';
import { moonIcon, sunIcon } from '@/lib/icons';
import styles from './style.module.css';
import type { ColorScheme } from '@/data/core';

const WPCOM_PROFILE_URL = 'https://wordpress.com/me';
const DOCS_URL = 'https://developer.wordpress.com/docs/developer-tools/studio/';
const REPORT_ISSUE_URL = 'https://github.com/Automattic/studio/issues/new/choose';

export function UserMenu() {
	const connector = useConnector();
	const { data: user } = useAuthUser();
	const { data: preferences } = useUserPreferences();
	const savePreferences = useSaveUserPreferences();
	const login = useLogin();
	const logout = useLogout();
	const navigate = useNavigate();

	const isOffline = useOffline();
	const currentScheme: ColorScheme = preferences?.colorScheme ?? 'system';
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
							<Menu.Item disabled={ isOffline } onClick={ () => openLink( WPCOM_PROFILE_URL ) }>
								{ __( 'Edit WordPress.com profile' ) }
							</Menu.Item>
							<Menu.Item disabled={ isOffline } onClick={ () => openLink( DOCS_URL ) }>
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
						className={ styles.settingsButton }
						icon={ cog }
						label={ __( 'Settings' ) }
						onClick={ () => void navigate( { to: '/settings' } ) }
					/>
				) : null }
				<Menu.Root modal={ false }>
					<Menu.Trigger
						render={
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								className={ styles.themeToggle }
								icon={ themeIsDark ? sunIcon : moonIcon }
								label={ __( 'Appearance' ) }
							/>
						}
					/>
					<Menu.Popup side="top" align="end">
						<Menu.RadioGroup
							value={ currentScheme }
							onValueChange={ ( value ) =>
								savePreferences.mutate( { colorScheme: value as ColorScheme } )
							}
						>
							<Menu.RadioItem value="system">{ __( 'System' ) }</Menu.RadioItem>
							<Menu.RadioItem value="light">{ __( 'Light' ) }</Menu.RadioItem>
							<Menu.RadioItem value="dark">{ __( 'Dark' ) }</Menu.RadioItem>
						</Menu.RadioGroup>
					</Menu.Popup>
				</Menu.Root>
			</div>
		</div>
	);
}
