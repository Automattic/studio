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
				className="text-white hover:!text-white !px-2 gap-2"
			>
				<span>{ sprintf( __( 'Howdy, %s' ), user?.displayName ) }</span> <Gravatar />
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
				className="flex gap-x-2 justify-between w-full text-white rounded !px-0 py-1 h-auto active:!text-white hover:!text-white hover:underline items-end"
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
		<div className="flex justify-between items-center text-white p-2">
			<Button
				className="app-no-drag-region"
				onClick={ onToggleSidebar }
				variant="icon"
				aria-label={ __( 'Toggle Sidebar' ) }
			>
				<Icon className="text-white" icon={ drawerLeft } size={ 24 } />
			</Button>

			<div className="app-no-drag-region flex items-center space-x-4">
				<Authentication />
				<Button onClick={ openDocs } aria-label={ __( 'Help' ) } variant="icon">
					<Icon className="text-white" size={ 24 } icon={ help } />
				</Button>
			</div>
		</div>
	);
}
