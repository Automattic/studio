import { __ } from '@wordpress/i18n';
import { displayShortcut } from '@wordpress/keycodes';
import { SettingsIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from '@/data/app-messages';
import { useAuthUser, useLogout } from '@/data/queries/use-auth-user';
import { getSections } from '@/data/settings-sections';
import { useOpenSettings } from '@/data/use-open-settings';
import { AccountPromptDialog } from '@/features/account/account-prompt';
import { Gravatar } from '@/features/account/gravatar';
import { AppUpdateButton } from '@/features/notifications';
import { LoginIcon } from '@/lib/icons';
import { Button, Menu } from '@/lib/ui';
import styles from './style.module.css';
import { SupportMenu } from './support-menu';

const MENU_SECTIONS: string[] = [ 'connections', 'usage' ];

export function UserMenu() {
	const { data: user } = useAuthUser();
	const logout = useLogout();
	const openSettingsDialog = useOpenSettings();
	const openSettings = () => openSettingsDialog();
	const [ promptOpen, setPromptOpen ] = useState( false );
	if ( user && promptOpen ) {
		setPromptOpen( false );
	}
	const trigger = useRef< HTMLButtonElement >( null );
	const sections = getSections( 'studio', { signedIn: !! user } ).filter( ( section ) =>
		MENU_SECTIONS.includes( section.id )
	);

	return (
		<div className={ styles.root }>
			<div className={ styles.row }>
				<Menu.Root>
					<Menu.Trigger
						render={
							<Button
								ref={ trigger }
								className={ user ? undefined : styles.loginTrigger }
								variant={ user ? 'muted-ghost' : 'outline' }
								size={ user ? 'icon-sm' : 'icon' }
								aria-label={ user ? user.displayName || user.email : __( 'Account' ) }
							/>
						}
					>
						{ user ? <Gravatar email={ user.email } className={ styles.avatar } /> : <LoginIcon /> }
					</Menu.Trigger>
					<Menu.Popup side="top" align="start" className={ styles.popup }>
						<AppUpdateButton placement="menu" />
						{ user && (
							<>
								<div className={ styles.account }>
									<Gravatar email={ user.email } />
									<div className={ styles.accountText }>
										<span className={ styles.accountName }>{ user.displayName || user.email }</span>
										{ user.displayName ? (
											<span className={ styles.accountEmail }>{ user.email }</span>
										) : null }
									</div>
								</div>
								<Menu.Separator />
							</>
						) }
						{ sections.map( ( section ) => (
							<Menu.Item key={ section.id } onClick={ () => openSettingsDialog( section.id ) }>
								<section.icon />
								{ section.label }
							</Menu.Item>
						) ) }
						<SupportMenu />
						<Menu.Item onClick={ openSettings }>
							<SettingsIcon />
							<span className={ styles.itemLabel }>{ __( 'Settings' ) }</span>
							<kbd className={ styles.shortcut }>{ displayShortcut.primary( ',' ) }</kbd>
						</Menu.Item>
						<Menu.Separator />
						{ user ? (
							<Menu.Item
								onClick={ () =>
									logout.mutate( undefined, {
										onError: ( logoutError ) =>
											toast.error( __( 'Could not log out' ), {
												description: logoutError.message,
											} ),
									} )
								}
							>
								<LoginIcon reverse />
								{ __( 'Log out' ) }
							</Menu.Item>
						) : (
							<Menu.Item onClick={ () => setPromptOpen( true ) }>
								<LoginIcon />
								{ __( 'Log in or create account' ) }
							</Menu.Item>
						) }
					</Menu.Popup>
				</Menu.Root>
				<div className={ styles.updateSlot }>
					<AppUpdateButton />
				</div>
			</div>
			<AccountPromptDialog
				open={ promptOpen }
				onOpenChange={ setPromptOpen }
				finalFocus={ trigger }
				title={ __( 'Do more with WordPress' ) }
				description={ __(
					'Create a free WordPress.com account to build with the agent, share previews, and publish.'
				) }
				source="settings"
				analytics={ { placement: 'account_menu', intent: 'account' } }
			/>
		</div>
	);
}
