import { __, sprintf } from '@wordpress/i18n';
import { Icon, help, drawerLeft } from '@wordpress/icons';
import { STUDIO_DOCS_URL } from '../constants';
import { useAuth } from '../hooks/use-auth';
import { useOffline } from '../hooks/use-offline';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { Gravatar } from './gravatar';
import offlineIcon from './offline-icon';
import { Tooltip } from './tooltip';
import { WordPressLogo } from './wordpress-logo';

interface TopBarProps {
	onToggleSidebar: () => void;
}

function ToggleSidebar( { onToggleSidebar }: TopBarProps ) {
	return (
		<div className="app-no-drag-region">
			<Tooltip text={ __( 'Toggle sidebar' ) } className="h-6">
				<Button onClick={ onToggleSidebar } variant="icon" aria-label={ __( 'Toggle sidebar' ) }>
					<Icon className="text-white" icon={ drawerLeft } size={ 24 } />
				</Button>
			</Tooltip>
		</div>
	);
}

function OfflineIndicator() {
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
				>
					<Button
						aria-label={ __( 'Offline indicator' ) }
						aria-description={ offlineMessage.join( ' ' ) }
						className="cursor-default !w-6 !h-6"
						variant="icon"
					>
						<Icon className="text-white" size={ 18 } icon={ offlineIcon } />
					</Button>
				</Tooltip>
			</div>
		)
	);
}

function Authentication() {
	const { isAuthenticated, user } = useAuth();
	if ( isAuthenticated ) {
		return (
			<Button
				onClick={ () => getIpcApi().showUserSettings() }
				aria-label={ __( 'Open settings' ) }
				tooltipText={ __( 'Open settings' ) }
				variant="icon"
				className="text-white hover:!text-white !px-1 py-1 !h-6 gap-2"
			>
				<span>{ sprintf( __( 'Howdy, %s' ), user?.displayName ) }</span>{ ' ' }
				<Gravatar size={ 18 } className="border-white border-[1.5px]" />
			</Button>
		);
	}

	return (
		<Button
			onClick={ () => getIpcApi().showUserSettings() }
			aria-label={ __( 'Open settings to log in' ) }
			tooltipText={ __( 'Open settings to log in' ) }
			className="flex gap-x-2 justify-between w-full text-white rounded !px-0 !py-0 h-auto active:!text-white hover:!text-white hover:underline items-center"
		>
			<WordPressLogo />

			<div className="text-s text-right">{ __( 'Log in' ) }</div>
		</Button>
	);
}

export default function TopBar( { onToggleSidebar }: TopBarProps ) {
	const openDocs = async () => {
		await getIpcApi().openURL( STUDIO_DOCS_URL );
	};

	return (
		<div className="flex justify-between items-center text-white px-2 pb-2 pt-1.5">
			<div className="flex items-center space-x-1.5">
				<ToggleSidebar onToggleSidebar={ onToggleSidebar } />
				<OfflineIndicator />
			</div>

			<div className="app-no-drag-region flex items-center space-x-4">
				<Authentication />
				<Button onClick={ openDocs } aria-label={ __( 'Get help' ) } variant="icon">
					<Icon className="text-white" size={ 24 } icon={ help } />
				</Button>
			</div>
		</div>
	);
}
