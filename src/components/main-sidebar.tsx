import { __ } from '@wordpress/i18n';
import { Icon, help } from '@wordpress/icons';
import { STUDIO_DOCS_URL } from '../constants';
import { useAuth } from '../hooks/use-auth';
import { useOffline } from '../hooks/use-offline';
import { isMac } from '../lib/app-globals';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import AddSite from './add-site';
import Button from './button';
import { Gravatar } from './gravatar';
import offlineIcon from './offline-icon';
import { RunningSites } from './running-sites';
import SiteMenu from './site-menu';
import Tooltip from './tooltip';
import UserSettings from './user-settings';
import { WordPressLogo } from './wordpress-logo';

interface MainSidebarProps {
	className?: string;
}

function SidebarAuthFooter() {
	const { isAuthenticated, authenticate } = useAuth();
	const isOffline = useOffline();
	const offlineMessage = __( 'You’re currently offline.' );
	const openDocs = async () => {
		await getIpcApi().openURL( STUDIO_DOCS_URL );
	};
	if ( isAuthenticated ) {
		return (
			<nav aria-label={ __( 'Global' ) }>
				<ul className="flex items-start self-stretch w-full">
					<li>
						<Button
							onClick={ () => getIpcApi().showUserSettings() }
							aria-label={ __( 'Account' ) }
							variant="icon"
						>
							<Gravatar className="m-1" />
						</Button>
					</li>
					<li className="ml-1.5">
						<Button onClick={ openDocs } aria-label={ __( 'Help' ) } variant="icon">
							<Icon size={ 22 } className="m-px text-white" icon={ help } />
						</Button>
					</li>
				</ul>
			</nav>
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

function SidebarToolbar() {
	const isOffline = useOffline();
	const offlineMessage = [
		__( 'You’re currently offline.' ),
		__( 'Some features will be unavailable.' ),
	];
	return (
		<div
			className={ cx(
				'absolute right-4 app-no-drag-region',
				isMac() && 'top-1',
				! isMac() && 'top-0'
			) }
		>
			{ isOffline && (
				<Tooltip
					text={
						<span>
							{ offlineMessage[ 0 ] }
							<br />
							{ offlineMessage[ 1 ] }
						</span>
					}
				>
					<Button
						aria-label={ __( 'Offline indicator' ) }
						aria-description={ offlineMessage.join( ' ' ) }
						className="cursor-default"
						variant="icon"
					>
						<Icon className="m-1 fill-white" size={ 16 } icon={ offlineIcon } />
					</Button>
				</Tooltip>
			) }
		</div>
	);
}

export default function MainSidebar( { className }: MainSidebarProps ) {
	return (
		<div
			data-testid="main-sidebar"
			className={ cx(
				'text-chrome-inverted relative',
				isMac() && 'pt-[50px]',
				! isMac() && 'pt-[38px]',
				className
			) }
		>
			<SidebarToolbar />
			<div className="flex flex-col h-full">
				<div
					className={ cx(
						'flex-1 overflow-y-auto sites-scrollbar app-no-drag-region',
						isMac() ? 'ml-4' : 'ml-3'
					) }
				>
					<SiteMenu />
				</div>
				<div className="flex flex-col gap-4 pt-5 border-white border-t border-opacity-10 app-no-drag-region">
					<RunningSites />
					<div className={ cx( isMac() ? 'mx-5' : 'mx-4' ) }>
						<AddSite className="w-full mb-4" />
						<div className="mb-[6px]">
							<SidebarAuthFooter />
						</div>
						<UserSettings />
					</div>
				</div>
			</div>
		</div>
	);
}
