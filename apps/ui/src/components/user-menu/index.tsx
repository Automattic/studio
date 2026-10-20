import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Icon, offline } from '@wordpress/icons';
import { IconButton, Tooltip } from '@wordpress/ui';
import { Gravatar } from '@/components/gravatar';
import * as Menu from '@/components/menu';
import { NoticeHistoryButton } from '@/components/notice-history';
import { SidebarButton } from '@/components/sidebar-button';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOffline } from '@/hooks/use-offline';
import { settingsIcon } from '@/lib/icons';
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
					<Menu.Popup side="top" align="start">
						{ user ? (
							<>
								<Menu.Group>
									<Menu.GroupLabel>{ user.displayName || user.email }</Menu.GroupLabel>
								</Menu.Group>
								<Menu.Separator />
							</>
						) : null }
						<Menu.Item onClick={ openSettings }>{ __( 'Settings' ) }</Menu.Item>
						{ user ? (
							<Menu.Item onClick={ () => logout.mutate() }>{ __( 'Log out' ) }</Menu.Item>
						) : (
							<Menu.Item onClick={ () => login.mutate() }>{ __( 'Log in' ) }</Menu.Item>
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
