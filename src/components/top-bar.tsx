import { __, sprintf } from '@wordpress/i18n';
import { Icon, help, drawerLeft } from '@wordpress/icons';
import { STUDIO_DOCS_URL } from '../constants';
import { useAuth } from '../hooks/use-auth';
import { useOffline } from '../hooks/use-offline';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { Gravatar } from './gravatar';
import offlineIcon from './offline-icon';
import Tooltip from './tooltip';
import { WordPressLogo } from './wordpress-logo';

interface TopBarProps {
	onToggleSidebar: () => void;
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
	const { isAuthenticated, authenticate, user } = useAuth();
	const isOffline = useOffline();
	const offlineMessage = __( 'You’re currently offline.' );
	if ( isAuthenticated ) {
		return (
			<Button
				onClick={ () => getIpcApi().showUserSettings() }
				aria-label={ __( 'Account' ) }
				variant="icon"
				className="text-white hover:!text-white !px-1 py-1 !h-6 gap-2"
			>
				<span>{ sprintf( __( 'Howdy, %s' ), user?.displayName ) }</span>{ ' ' }
				<Gravatar size={ 18 } className="border-white border-[1.5px]" />
			</Button>
		);
	}

	return (
		<Tooltip
			disabled={ ! isOffline }
			icon={ offlineIcon }
			text={ offlineMessage }
			placement="right"
			className="flex"
		>
			<Button
				aria-description={ isOffline ? offlineMessage : '' }
				aria-disabled={ isOffline }
				className="flex gap-x-2 justify-between w-full text-white rounded !px-0 !py-1 h-auto active:!text-white hover:!text-white hover:underline items-end"
				onClick={ () => {
					if ( isOffline ) {
						return;
					}
					authenticate();
				} }
			>
				<WordPressLogo />

				<div className="text-xs text-right">{ __( 'Log in' ) }</div>
			</Button>
		</Tooltip>
	);
}

export default function TopBar( { onToggleSidebar }: TopBarProps ) {
	const openDocs = async () => {
		await getIpcApi().openURL( STUDIO_DOCS_URL );
	};

	return (
		<div className="flex justify-between items-center text-white px-2 pb-2 pt-1.5">
			<div className="flex items-center space-x-1.5">
				<Button
					className="app-no-drag-region"
					onClick={ onToggleSidebar }
					variant="icon"
					aria-label={ __( 'Toggle Sidebar' ) }
				>
					<Icon className="text-white" icon={ drawerLeft } size={ 24 } />
				</Button>

				<OfflineIndicator />
			</div>

			<div className="app-no-drag-region flex items-center space-x-1">
				<Authentication />
				<Button onClick={ openDocs } aria-label={ __( 'Help' ) } variant="icon">
					<Icon className="text-white" size={ 24 } icon={ help } />
				</Button>
			</div>
		</div>
	);
}
