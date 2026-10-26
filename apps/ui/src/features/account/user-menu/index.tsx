import { __ } from '@wordpress/i18n';
import { ariaKeyShortcut, displayShortcut } from '@wordpress/keycodes';
import { LogOutIcon, SettingsIcon, WifiOffIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from '@/data/app-messages';
import { useColorScheme } from '@/data/host/use-color-scheme';
import { useAuthUser, useLogout } from '@/data/queries/use-auth-user';
import { getSections } from '@/data/settings-sections';
import { useOpenSettings } from '@/data/use-open-settings';
import { AccountPromptDialog } from '@/features/account/account-prompt';
import { Gravatar } from '@/features/account/gravatar';
import { NoticeHistoryButton } from '@/features/notifications';
import { useOffline } from '@/lib/hooks';
import {
	Alert,
	AlertDescription,
	Button,
	IconButton,
	Menu,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/lib/ui';
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
	const [ menuWidth, setMenuWidth ] = useState< number >();
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
				{ user ? (
					<Menu.Root
						onOpenChange={ ( open ) => {
							const sidebar = open && trigger.current?.closest( 'aside' );
							if ( sidebar ) {
								setMenuWidth( sidebar.offsetWidth - 28 );
							}
						} }
					>
						<Menu.Trigger
							render={
								<Button
									ref={ trigger }
									variant="ghost"
									size="icon"
									aria-label={ user.displayName || user.email }
								/>
							}
						>
							<Gravatar email={ user.email } isDark={ themeIsDark } className={ styles.avatar } />
						</Menu.Trigger>
						<Menu.Popup
							side="top"
							align="start"
							className={ styles.popup }
							style={ { width: menuWidth } }
						>
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
							<Menu.Item onClick={ openSettings }>
								<SettingsIcon />
								<span className={ styles.itemLabel }>{ __( 'Settings' ) }</span>
								<kbd className={ styles.shortcut }>{ displayShortcut.primary( ',' ) }</kbd>
							</Menu.Item>
							{ sections.map( ( section ) => (
								<Menu.Item key={ section.id } onClick={ () => openSettingsDialog( section.id ) }>
									<section.icon />
									{ section.label }
								</Menu.Item>
							) ) }
							<Menu.Separator />
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
								<LogOutIcon />
								{ __( 'Log out' ) }
							</Menu.Item>
						</Menu.Popup>
					</Menu.Root>
				) : (
					<Button ref={ trigger } size="sm" onClick={ () => setPromptOpen( true ) }>
						{ __( 'Log in' ) }
					</Button>
				) }
				<span className={ styles.spacer } aria-hidden="true" />
				{ isOffline && <OfflineIndicator /> }
				<IconButton
					icon={ <SettingsIcon /> }
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
					'Build with WordPress Studio, share local previews publicly, launch on WordPress.com, and keep sites in sync.'
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
				<WifiOffIcon />
			</TooltipTrigger>
			<TooltipContent>
				{ __( "You're offline. Your local sites still work normally." ) }
			</TooltipContent>
		</Tooltip>
	);
}
