import { useNavigate, useRouterState } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Icon, settings } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useTourAnchor } from '@/components/coachmarks/anchor-registry';
import { Gravatar } from '@/components/gravatar';
import { SidebarButton } from '@/components/sidebar-button';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { drawerIcon } from '@/lib/icons';
import styles from './style.module.css';

type Props = {
	onToggleSidebar?: () => void;
};

export function UserMenu( { onToggleSidebar }: Props ) {
	const { data: user } = useAuthUser();
	const navigate = useNavigate();
	const settingsAnchorRef = useTourAnchor( 'sidebar-user-menu' );
	const themeIsDark = useColorScheme() === 'dark';
	// Settings is a dashboard view like any other, so the row carries the same
	// selected treatment as the site rows above it.
	const isSettingsActive = useRouterState( {
		select: ( state ) => /^\/settings\/?$/.test( state.location.pathname ),
	} );

	return (
		<div className={ styles.root }>
			<div
				className={ clsx( styles.row, isSettingsActive && styles.rowActive ) }
				ref={ settingsAnchorRef }
			>
				<SidebarButton
					className={ styles.userTrigger }
					aria-current={ isSettingsActive ? 'page' : undefined }
					onClick={ () => void navigate( { to: '/settings' } ) }
				>
					{ user ? (
						<Gravatar email={ user.email } isDark={ themeIsDark } />
					) : (
						<span className={ styles.settingsAvatar } aria-hidden="true">
							<Icon icon={ settings } size={ 14 } />
						</span>
					) }
					<span className={ styles.userName }>{ __( 'Settings' ) }</span>
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
