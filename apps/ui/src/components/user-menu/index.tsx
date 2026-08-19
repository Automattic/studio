import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Icon, settings } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { Gravatar } from '@/components/gravatar';
import { SidebarButton } from '@/components/sidebar-button';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { drawerIcon } from '@/lib/icons';
import styles from './style.module.css';

type Props = {
	onToggleSidebar: () => void;
};

export function UserMenu( { onToggleSidebar }: Props ) {
	const { data: user } = useAuthUser();
	const navigate = useNavigate();
	const themeIsDark = useColorScheme() === 'dark';

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
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					className={ styles.sidebarToggle }
					icon={ drawerIcon }
					label={ __( 'Hide sidebar' ) }
					onClick={ onToggleSidebar }
				/>
			</div>
		</div>
	);
}
