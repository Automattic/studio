import { Link } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
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
	const effectiveScheme = usePrefersColorScheme();

	const savedScheme = preferences?.colorScheme;
	const themeIsDark =
		savedScheme === 'dark' || ( savedScheme !== 'light' && effectiveScheme === 'dark' );

	return (
		<div className={ styles.root }>
			<div className={ styles.row }>
				{ user ? (
					<SidebarButton
						className={ styles.userTrigger }
						render={
							<Link
								to="/settings"
								search={ { tab: 'account' } }
								activeOptions={ { exact: true, includeSearch: false } }
								activeProps={ {
									className: `${ styles.userTrigger } ${ styles.userTriggerActive }`,
								} }
							/>
						}
					>
						<Gravatar email={ user.email } isDark={ themeIsDark } className={ styles.avatar } />
						<span className={ styles.userName }>{ user.displayName }</span>
					</SidebarButton>
				) : (
					<SidebarButton className={ styles.loginButton } onClick={ () => login.mutate() }>
						{ __( 'Log in with WordPress.com' ) }
					</SidebarButton>
				) }
			</div>
		</div>
	);
}
