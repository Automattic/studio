import { Dropdown, MenuGroup, MenuItem } from '@wordpress/components';
import { Icon, help, drawerLeft, cog, external } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import Button from 'src/components/button';
import { Gravatar } from 'src/components/gravatar';
import offlineIcon from 'src/components/offline-icon';
import { RemoteSessionIndicator } from 'src/components/remote-session-indicator';
import { Tooltip } from 'src/components/tooltip';
import { WordPressLogo } from 'src/components/wordpress-logo';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import { FeedbackModal } from 'src/modules/feedback';
import { useI18nLocale } from 'src/stores';

interface TopBarProps {
	onToggleSidebar: () => void;
}

const DEFAULT_TOOLTIP_PLACEMENT = 'bottom-start';

function ToggleSidebar( { onToggleSidebar }: TopBarProps ) {
	const { __ } = useI18n();
	return (
		<div className="app-no-drag-region ml-2">
			<Tooltip text={ __( 'Toggle sidebar' ) } placement={ DEFAULT_TOOLTIP_PLACEMENT }>
				<Button
					onClick={ onToggleSidebar }
					variant="icon"
					aria-label={ __( 'Toggle sidebar' ) }
					className="!p-1.5 !rounded-lg"
				>
					<Icon className="text-white" icon={ drawerLeft } size={ 24 } />
				</Button>
			</Tooltip>
		</div>
	);
}

function OfflineIndicator() {
	const { __ } = useI18n();
	const isOffline = useOffline();
	const offlineMessage = [
		__( 'You’re currently offline.' ),
		__( 'Some features will be unavailable.' ),
	];
	return (
		isOffline && (
			<div className="app-no-drag-region">
				<Tooltip
					text={
						<span>
							{ offlineMessage[ 0 ] }
							<br />
							{ offlineMessage[ 1 ] }
						</span>
					}
					className="h-6"
					placement={ DEFAULT_TOOLTIP_PLACEMENT }
				>
					<span
						role="status"
						aria-label={ __( 'Offline indicator' ) }
						aria-description={ offlineMessage.join( ' ' ) }
						className="inline-flex items-center justify-center w-6 h-6"
					>
						<Icon className="text-white fill-white" size={ 18 } icon={ offlineIcon } />
					</span>
				</Tooltip>
			</div>
		)
	);
}

function Authentication() {
	const { __ } = useI18n();
	const { isAuthenticated, user } = useAuth();
	const isOffline = useOffline();
	if ( isAuthenticated ) {
		return (
			<Tooltip text={ user?.displayName || '' } placement="bottom-end">
				<Button
					onClick={ () => getIpcApi().showUserSettings( 'account' ) }
					aria-label={ __( 'Open account settings' ) }
					variant="icon"
					className="!p-[8px] !rounded-lg"
				>
					<Gravatar size={ 20 } className="border-white border-[1.5px]" />
				</Button>
			</Tooltip>
		);
	}

	return (
		<Button
			onClick={ () => getIpcApi().authenticate( false ) }
			aria-label={ __( 'Log in to Studio with WordPress.com' ) }
			variant="icon"
			className="flex gap-x-2 justify-between w-full text-white !rounded-lg !px-2 !py-1.5 h-auto active:!text-white hover:!text-white hover:underline items-center"
			disabled={ isOffline }
		>
			<WordPressLogo />

			<div className="text-s text-right">{ __( 'Log in' ) }</div>
		</Button>
	);
}

function SettingsButton() {
	const { __ } = useI18n();

	return (
		<Tooltip text={ __( 'Settings' ) } placement="bottom-end">
			<Button
				onClick={ () => void getIpcApi().showUserSettings( 'general' ) }
				aria-label={ __( 'Open settings' ) }
				variant="icon"
				className="!p-1.5 !rounded-lg"
				data-testid="settings-button"
			>
				<Icon className="text-white" size={ 24 } icon={ cog } />
			</Button>
		</Tooltip>
	);
}

export default function TopBar( { onToggleSidebar }: TopBarProps ) {
	const { __ } = useI18n();
	const locale = useI18nLocale();
	const { isAuthenticated, user } = useAuth();
	const [ isFeedbackOpen, setIsFeedbackOpen ] = useState( false );

	const openDocs = () => {
		getIpcApi().openURL( getLocalizedLink( locale, 'docsStudio' ) );
	};

	return (
		<>
			<div className="flex justify-between items-center text-white pl-2 pr-0.5">
				<div className="flex items-center space-x-1.5 rtl:space-x-reverse">
					<ToggleSidebar onToggleSidebar={ onToggleSidebar } />
					<OfflineIndicator />
				</div>

				<div className="app-no-drag-region flex items-center space-x-1.5 rtl:space-x-reverse">
					<Authentication />
					<SettingsButton />
					<Dropdown
						popoverProps={ { placement: 'bottom-end' } }
						renderToggle={ ( { isOpen, onToggle } ) => (
							<Tooltip text={ __( 'Help' ) } placement="bottom-end">
								<Button
									onClick={ onToggle }
									aria-label={ __( 'Help' ) }
									aria-expanded={ isOpen }
									variant="icon"
									className="!p-1.5 !rounded-lg"
								>
									<Icon className="text-white" size={ 24 } icon={ help } />
								</Button>
							</Tooltip>
						) }
						renderContent={ ( { onClose } ) => (
							<MenuGroup className="w-48">
								<MenuItem
									icon={ external }
									iconPosition="right"
									onClick={ () => {
										onClose();
										openDocs();
									} }
								>
									{ __( 'Docs' ) }
								</MenuItem>
								<MenuItem
									onClick={ () => {
										onClose();
										setIsFeedbackOpen( true );
									} }
								>
									{ __( 'Send feedback' ) }
								</MenuItem>
							</MenuGroup>
						) }
					/>
					<RemoteSessionIndicator />
				</div>
			</div>
			{ isFeedbackOpen && (
				<FeedbackModal
					identity={ {
						isAuthenticated,
						email: user?.email,
						displayName: user?.displayName,
					} }
					source="menu"
					onClose={ () => setIsFeedbackOpen( false ) }
				/>
			) }
		</>
	);
}
