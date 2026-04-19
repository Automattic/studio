import { __ } from '@wordpress/i18n';
import { Button, IconButton } from '@wordpress/ui';
import { Gravatar } from '@/components/gravatar';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useColorScheme, useSaveColorScheme } from '@/data/queries/use-color-scheme';
import { usePrefersColorScheme } from '@/hooks/use-prefers-color-scheme';
import { moonIcon, sunIcon } from '@/lib/icons';
import styles from './style.module.css';
import type { ColorScheme } from '@/data/core';

const WPCOM_PROFILE_URL = 'https://wordpress.com/me';
const DOCS_URL = 'https://developer.wordpress.com/docs/developer-tools/studio/';
const REPORT_ISSUE_URL = 'https://github.com/Automattic/studio/issues/new/choose';

export function UserMenu() {
	const connector = useConnector();
	const { data: user } = useAuthUser();
	const { data: savedScheme } = useColorScheme();
	const saveColorScheme = useSaveColorScheme();
	const login = useLogin();
	const logout = useLogout();
	const effectiveScheme = usePrefersColorScheme();

	const currentScheme: ColorScheme = savedScheme ?? 'system';
	const themeIsDark =
		savedScheme === 'dark' || ( savedScheme !== 'light' && effectiveScheme === 'dark' );

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
								<Button
									variant="minimal"
									tone="neutral"
									size="small"
									className={ styles.userTrigger }
								>
									<Gravatar email={ user.email } isDark={ themeIsDark } />
									<span className={ styles.userName }>{ user.displayName }</span>
								</Button>
							}
						/>
						<Menu.Popup side="top" align="start" className={ styles.popup }>
							<div className={ styles.email } title={ user.email }>
								{ user.email }
							</div>
							<Menu.Item onClick={ () => openLink( WPCOM_PROFILE_URL ) }>
								{ __( 'Edit profile' ) }
							</Menu.Item>
							<Menu.Item onClick={ () => openLink( DOCS_URL ) }>
								{ __( 'Documentation' ) }
							</Menu.Item>
							<Menu.Item onClick={ () => openLink( REPORT_ISSUE_URL ) }>
								{ __( 'Report an issue' ) }
							</Menu.Item>
							<Menu.Separator />
							<Menu.Item onClick={ () => logout.mutate() }>{ __( 'Log out' ) }</Menu.Item>
						</Menu.Popup>
					</Menu.Root>
				) : (
					<Button
						variant="minimal"
						tone="neutral"
						size="small"
						className={ styles.loginButton }
						onClick={ () => login.mutate() }
					>
						{ __( 'Log in with WordPress.com' ) }
					</Button>
				) }
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
							onValueChange={ ( value ) => saveColorScheme.mutate( value as ColorScheme ) }
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
