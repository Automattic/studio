import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Icon, offline, settings } from '@wordpress/icons';
import { Tooltip } from '@wordpress/ui';
import { Gravatar } from '@/components/gravatar';
import { NoticeHistoryButton } from '@/components/notice-history';
import { SidebarButton } from '@/components/sidebar-button';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOffline } from '@/hooks/use-offline';
import styles from './style.module.css';

export function UserMenu() {
	const { data: user } = useAuthUser();
	const navigate = useNavigate();
	const themeIsDark = useColorScheme() === 'dark';
	const isOffline = useOffline();

	return (
		<div className={ styles.root }>
			<div className={ styles.row }>
				<SidebarButton
					className={ styles.userTrigger }
					onClick={ () => void navigate( { to: '/settings' } ) }
				>
					{ user ? (
						<Gravatar email={ user.email } isDark={ themeIsDark } />
					) : (
						<span className={ styles.settingsAvatar } aria-hidden="true">
							<Icon icon={ settings } size={ 14 } />
						</span>
					) }
					<span className={ styles.userName }>{ __( 'App settings' ) }</span>
				</SidebarButton>
				{ isOffline && <OfflineIndicator /> }
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
