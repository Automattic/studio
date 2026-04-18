import { __ } from '@wordpress/i18n';
import { Button, IconButton } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useColorScheme, useSaveColorScheme } from '@/data/queries/use-color-scheme';
import { usePrefersColorScheme } from '@/hooks/use-prefers-color-scheme';
import styles from './style.module.css';
import type { ColorScheme } from '@/data/core';

const WPCOM_PROFILE_URL = 'https://wordpress.com/me';
const DOCS_URL = 'https://developer.wordpress.com/docs/developer-tools/studio/';
const REPORT_ISSUE_URL = 'https://github.com/Automattic/studio/issues/new/choose';

const sunIcon = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
		<circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
		<path
			d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
		/>
	</svg>
);

const moonIcon = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
		<path
			d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinejoin="round"
		/>
	</svg>
);

const userIcon = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
		<circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
		<path
			d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
		/>
	</svg>
);

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
									<Button.Icon icon={ userIcon } size={ 16 } />
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
