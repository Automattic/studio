import { useNavigate, useRouterState } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { cog } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { Gravatar } from '@/components/gravatar';
import { SidebarButton } from '@/components/sidebar-button';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { usePrefersColorScheme } from '@/hooks/use-prefers-color-scheme';
import styles from './style.module.css';

export function UserMenu() {
	const { data: user } = useAuthUser();
	const { data: preferences } = useUserPreferences();
	const login = useLogin();
	const navigate = useNavigate();
	const settingsActive = useRouterState( {
		select: ( state ) => state.location.pathname === '/settings',
	} );
	const effectiveScheme = usePrefersColorScheme();

	const savedScheme = preferences?.colorScheme;
	const themeIsDark =
		savedScheme === 'dark' || ( savedScheme !== 'light' && effectiveScheme === 'dark' );

	const openAccountSettings = () => {
		void navigate( { to: '/settings' } );
	};

	return (
		<div className={ styles.root }>
			<div className={ styles.row }>
				{ user ? (
					<SidebarButton
						className={ clsx( styles.userTrigger, settingsActive && styles.userTriggerActive ) }
						aria-label={ __( 'Open account settings' ) }
						aria-current={ settingsActive ? 'page' : undefined }
						onClick={ openAccountSettings }
					>
						<Gravatar email={ user.email } isDark={ themeIsDark } />
						<span className={ styles.userName }>{ user.displayName }</span>
					</SidebarButton>
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
						className={ clsx(
							styles.settingsButton,
							settingsActive && styles.settingsButtonActive
						) }
						aria-current={ settingsActive ? 'page' : undefined }
						onClick={ openAccountSettings }
					/>
				) : null }
			</div>
		</div>
	);
}
