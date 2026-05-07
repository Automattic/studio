import { __ } from '@wordpress/i18n';
import { chevronDownSmall } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { Gravatar } from '@/components/gravatar';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { usePrefersColorScheme } from '@/hooks/use-prefers-color-scheme';
import styles from './style.module.css';

const WPCOM_PROFILE_URL = 'https://wordpress.com/me';
const DOCS_URL = 'https://developer.wordpress.com/docs/developer-tools/studio/';
const REPORT_ISSUE_URL = 'https://github.com/Automattic/studio/issues/new/choose';

export function DeskUserMenu() {
	const connector = useConnector();
	const { data: user } = useAuthUser();
	const { data: preferences } = useUserPreferences();
	const login = useLogin();
	const logout = useLogout();
	const effectiveScheme = usePrefersColorScheme();
	const savedScheme = preferences?.colorScheme;
	const themeIsDark =
		savedScheme === 'dark' || ( savedScheme !== 'light' && effectiveScheme === 'dark' );

	const openLink = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	if ( ! user ) {
		return (
			<Button
				variant="minimal"
				tone="neutral"
				size="small"
				className={ styles.trigger }
				onClick={ () => login.mutate() }
			>
				{ __( 'Log in with WordPress.com' ) }
			</Button>
		);
	}

	return (
		<Menu.Root modal={ false }>
			<Menu.Trigger
				render={
					<Button variant="minimal" tone="neutral" size="small" className={ styles.trigger }>
						<Gravatar email={ user.email } isDark={ themeIsDark } />
						<span className={ styles.userName }>{ user.displayName }</span>
						<Icon icon={ chevronDownSmall } />
					</Button>
				}
			/>
			<Menu.Popup side="bottom" align="start" className={ styles.popup }>
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
