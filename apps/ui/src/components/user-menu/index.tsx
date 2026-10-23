import { __ } from '@wordpress/i18n';
import { Icon, offline } from '@wordpress/icons';
import { ariaKeyShortcut, displayShortcut } from '@wordpress/keycodes';
import { useRef, useState } from 'react';
import { AccountPromptDialog } from '@/components/account-prompt';
import { Gravatar } from '@/components/gravatar';
import { NoticeHistoryButton } from '@/components/notice-history';
import { getSections } from '@/components/settings-dialog/sections';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, IconButton } from '@/components/ui/button';
import * as Menu from '@/components/ui/menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/data/app-messages';
import { useAuthUser, useLogout } from '@/data/queries/use-auth-user';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOffline } from '@/hooks/use-offline';
import { useOpenSettings } from '@/hooks/use-open-settings';
import { logOutIcon, settingsIcon } from '@/lib/icons';
import styles from './style.module.css';

const MENU_SECTIONS: string[] = [ 'appearance', 'ai', 'usage' ];

export function UserMenu() {
	const { data: user, error } = useAuthUser();
	const themeIsDark = useColorScheme() === 'dark';
	const isOffline = useOffline();
	const logout = useLogout();
	const openSettingsDialog = useOpenSettings();
	const openSettings = () => openSettingsDialog();
	const [ promptOpen, setPromptOpen ] = useState( false );
	if ( user && promptOpen ) {
		setPromptOpen( false );
	}
	const trigger = useRef< HTMLButtonElement >( null );
	const promptRequested = useRef( false );
	const sections = getSections( 'studio', { signedIn: !! user } ).filter( ( section ) =>
		MENU_SECTIONS.includes( section.id )
	);

	return (
		<div className={ styles.root }>
			{ error ? (
				<Alert variant="destructive" className={ styles.alert }>
					<AlertDescription>{ error.message }</AlertDescription>
				</Alert>
			) : null }
			<div className={ styles.row }>
				<Menu.Root
					// The prompt opens once the menu is gone, so the menu's own click can't dismiss it.
					onOpenChangeComplete={ ( open ) => {
						if ( ! open && promptRequested.current ) {
							promptRequested.current = false;
							setPromptOpen( true );
						}
					} }
				>
					<Menu.Trigger
						render={
							<Button
								ref={ trigger }
								variant="ghost"
								size="icon"
								className={ styles.userTrigger }
								aria-label={ __( 'Account' ) }
							/>
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
					<Menu.Popup side="top" align="start" className={ styles.popup }>
						{ user ? (
							<>
								<div className={ styles.account }>
									<Gravatar email={ user.email } isDark={ themeIsDark } />
									<div className={ styles.accountText }>
										<span className={ styles.accountName }>{ user.displayName || user.email }</span>
										{ user.displayName ? (
											<span className={ styles.accountEmail }>{ user.email }</span>
										) : null }
									</div>
								</div>
								<Menu.Separator />
							</>
						) : null }
						<Menu.Item onClick={ openSettings }>
							<Icon icon={ settingsIcon } />
							<span className={ styles.itemLabel }>{ __( 'Settings' ) }</span>
							<kbd className={ styles.shortcut }>{ displayShortcut.primary( ',' ) }</kbd>
						</Menu.Item>
						{ sections.map( ( section ) => (
							<Menu.Item key={ section.id } onClick={ () => openSettingsDialog( section.id ) }>
								<Icon icon={ section.icon } />
								{ section.label }
							</Menu.Item>
						) ) }
						<Menu.Separator />
						{ user ? (
							<Menu.Item
								onClick={ () =>
									logout.mutate( undefined, {
										onError: ( logoutError ) =>
											toast.error( __( 'Could not log out.' ), {
												description: logoutError.message,
											} ),
									} )
								}
							>
								<Icon icon={ logOutIcon } />
								{ __( 'Log out' ) }
							</Menu.Item>
						) : (
							<Menu.Item onClick={ () => ( promptRequested.current = true ) }>
								<Icon icon={ logOutIcon } />
								{ __( 'Log in' ) }
							</Menu.Item>
						) }
					</Menu.Popup>
				</Menu.Root>
				<span className={ styles.spacer } aria-hidden="true" />
				{ isOffline && <OfflineIndicator /> }
				<IconButton
					icon={ settingsIcon }
					label={ __( 'Settings' ) }
					shortcut={ {
						displayShortcut: displayShortcut.primary( ',' ),
						ariaKeyShortcut: ariaKeyShortcut.primary( ',' ),
					} }
					onClick={ openSettings }
				/>
				<NoticeHistoryButton />
			</div>
			<AccountPromptDialog
				open={ promptOpen }
				onOpenChange={ setPromptOpen }
				finalFocus={ trigger }
				title={ __( 'Do more with WordPress.com' ) }
				description={ __(
					'Build with Studio, share local previews publicly, launch on WordPress.com, and keep sites in sync.'
				) }
				source="settings"
			/>
		</div>
	);
}

function OfflineIndicator() {
	const label = __( "You're offline" );
	return (
		<Tooltip>
			<TooltipTrigger
				render={ <span className={ styles.offline } role="img" aria-label={ label } /> }
			>
				<Icon icon={ offline } size={ 20 } />
			</TooltipTrigger>
			<TooltipContent>
				{ __( "You're offline. Your local sites still work normally." ) }
			</TooltipContent>
		</Tooltip>
	);
}
