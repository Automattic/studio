import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { Gravatar } from '@/components/gravatar';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { usePrefersColorScheme } from '@/hooks/use-prefers-color-scheme';
import { useDesksLocation, useDesksNavigate } from '../router/navigation';
import styles from './style.module.css';

const WPCOM_PROFILE_URL = 'https://wordpress.com/me';
const DOCS_URL = 'https://developer.wordpress.com/docs/developer-tools/studio/';
const REPORT_ISSUE_URL = 'https://github.com/Automattic/studio/issues/new/choose';

export function DeskUserMenu() {
	const navigate = useDesksNavigate();
	const location = useDesksLocation();
	const connector = useConnector();
	const { data: user } = useAuthUser();
	const { data: preferences } = useUserPreferences();
	const login = useLogin();
	const logout = useLogout();
	const effectiveScheme = usePrefersColorScheme();
	const savedScheme = preferences?.colorScheme;
	const themeIsDark =
		savedScheme === 'dark' || ( savedScheme !== 'light' && effectiveScheme === 'dark' );
	const showUserDashboardItem = location.pathname !== '/';

	const openLink = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const openUserDashboard = () => {
		void navigate( { to: '/' } );
	};

	if ( ! user ) {
		return (
			<Button
				variant="minimal"
				tone="neutral"
				size="small"
				className={ styles.trigger }
				aria-label={ __( 'Log in with WordPress.com' ) }
				onClick={ () => login.mutate() }
			>
				<span className={ styles.loginAvatar } aria-hidden="true" />
			</Button>
		);
	}

	return (
		<Menu.Root modal={ false }>
			<Menu.Trigger
				render={
					<Button
						variant="minimal"
						tone="neutral"
						size="small"
						className={ styles.trigger }
						aria-label={ __( 'User menu' ) }
						title={ user.displayName }
					>
						<Gravatar className={ styles.avatar } email={ user.email } isDark={ themeIsDark } />
					</Button>
				}
			/>
			<Menu.Popup side="bottom" align="start" className={ styles.popup }>
				{ showUserDashboardItem ? (
					<>
						<Menu.Item onClick={ openUserDashboard }>{ __( 'User Dashboard' ) }</Menu.Item>
						<Menu.Separator />
					</>
				) : null }
				<div className={ styles.email } title={ user.email }>
					{ user.email }
				</div>
				<Menu.Item onClick={ () => openLink( WPCOM_PROFILE_URL ) }>
					{ __( 'Edit WordPress.com profile' ) }
				</Menu.Item>
				<Menu.Item onClick={ () => openLink( DOCS_URL ) }>{ __( 'Documentation' ) }</Menu.Item>
				<Menu.Item onClick={ () => openLink( REPORT_ISSUE_URL ) }>
					{ __( 'Report an issue' ) }
				</Menu.Item>
				<Menu.Separator />
				<Menu.Item onClick={ () => logout.mutate() }>{ __( 'Log out' ) }</Menu.Item>
			</Menu.Popup>
		</Menu.Root>
	);
}
