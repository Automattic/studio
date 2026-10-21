import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Icon, offline } from '@wordpress/icons';
import { displayShortcut } from '@wordpress/keycodes';
import { IconButton, Tooltip } from '@wordpress/ui';
import { Gravatar } from '@/components/gravatar';
import * as Menu from '@/components/menu';
import { NoticeHistoryButton } from '@/components/notice-history';
import { SidebarButton } from '@/components/sidebar-button';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOffline } from '@/hooks/use-offline';
import { logOutIcon, settingsIcon } from '@/lib/icons';
import styles from './style.module.css';

export function UserMenu() {
	const { data: user } = useAuthUser();
	const navigate = useNavigate();
	const themeIsDark = useColorScheme() === 'dark';
	const isOffline = useOffline();
	const login = useLogin( { source: 'settings' } );
	const logout = useLogout();
	const openSettings = () => void navigate( { to: '/settings' } );

	return (
		<div className={ styles.root }>
			<div className={ styles.row }>
				<Menu.Root>
					<Menu.Trigger
						render={
							<SidebarButton className={ styles.userTrigger } aria-label={ __( 'Account' ) } />
						}
					>
						{ user ? (
							<Gravatar email={ user.email } isDark={ themeIsDark } />
						) : (
							<span className={ styles.settingsAvatar } aria-hidden="true">
								<Icon icon={ settingsIcon } />
							</span>
						) }
					</Menu.Trigger>
					<Menu.Popup side="top" align="start" className={ styles.popup }>
						{ user ? (
							<>
								<div className={ styles.account }>
									<Gravatar email={ user.email } isDark={ themeIsDark } />
									<div className={ styles.accountText }>
										<span className={ styles.accountName }>{ user.displayName || user.email }</span>
										{ user.displayName ? (
											<span className={ styles.accountEmail }>{ user.email }</span>
										) : null }
									</div>
								</div>
								<Menu.Separator />
							</>
						) : null }
						<Menu.Item onClick={ openSettings }>
							<Icon icon={ settingsIcon } />
							<span className={ styles.itemLabel }>{ __( 'Settings' ) }</span>
							<kbd className={ styles.shortcut }>{ displayShortcut.primary( ',' ) }</kbd>
						</Menu.Item>
						<Menu.Separator />
						{ user ? (
							<Menu.Item onClick={ () => logout.mutate() }>
								<Icon icon={ logOutIcon } />
								{ __( 'Log out' ) }
							</Menu.Item>
						) : (
							<Menu.Item onClick={ () => login.mutate() }>
								<Icon icon={ logOutIcon } />
								{ __( 'Log in' ) }
							</Menu.Item>
						) }
					</Menu.Popup>
				</Menu.Root>
				<span className={ styles.spacer } aria-hidden="true" />
				{ isOffline && <OfflineIndicator /> }
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					className="studio-control"
					icon={ settingsIcon }
					label={ __( 'Settings' ) }
					onClick={ openSettings }
				/>
				<NoticeHistoryButton />
			</div>
		</div>
	);
}

function OfflineIndicator() {
	const label = __( "You're offline" );
	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={ <span className={ styles.offline } role="img" aria-label={ label } /> }
			>
				<Icon icon={ offline } size={ 20 } />
			</Tooltip.Trigger>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
				{ __( "You're offline. Your local sites still work normally." ) }
			</Tooltip.Popup>
		</Tooltip.Root>
	);
}
